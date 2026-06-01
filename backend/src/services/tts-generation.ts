/**
 * TTS 语音合成服务
 * 支持 MiniMax TTS (hex 音频响应) 和 OpenAI 兼容 /audio/speech
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import ffmpeg from 'fluent-ffmpeg'
import { getAudioConfigById } from './ai.js'
import { getTTSAdapter } from './adapters/registry.js'
import type { DialogueSegment } from './dialogue-utils.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')

interface TTSParams {
  text: string
  voice?: string
  voiceProvider?: string
  model?: string
  speed?: number
  emotion?: string
  configId?: number | null
}

const OPENAI_VOICE_IDS = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
const MINIMAX_DEFAULT_VOICE = process.env.MINIMAX_TTS_DEFAULT_VOICE || 'male-qn-qingse'

function normalizeTTSVoice(provider: string, voice?: string) {
  const raw = String(voice || '').trim()
  if (provider.toLowerCase() === 'minimax' && (!raw || OPENAI_VOICE_IDS.has(raw))) {
    return MINIMAX_DEFAULT_VOICE
  }
  return raw || MINIMAX_DEFAULT_VOICE
}

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

function describeFetchError(err: any) {
  const parts = [
    err?.message,
    err?.cause?.code,
    err?.cause?.errno,
    err?.cause?.syscall,
    err?.cause?.hostname,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : 'fetch failed'
}

/**
 * 生成 TTS 音频，返回本地文件路径
 */
export async function generateTTS(params: TTSParams): Promise<string> {
  const config = getAudioConfigById(params.configId)
  const adapter = getTTSAdapter(config.provider)
  const requestParams = {
    ...params,
    model: params.model || config.model,
    voice: normalizeTTSVoice(params.voiceProvider || config.provider, params.voice),
  }

  if (requestParams.voice !== params.voice) {
    logTaskWarn('AudioTask', 'voice-normalized', {
      provider: config.provider,
      from: params.voice,
      to: requestParams.voice,
      reason: 'voice id is empty or not supported by selected provider',
    })
  }

  logTaskStart('AudioTask', 'tts-generate', {
    provider: config.provider,
    voice: requestParams.voice,
    model: requestParams.model,
    textPreview: params.text.slice(0, 50),
    textLength: params.text.length,
  })
  logTaskPayload('AudioTask', 'tts params', {
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params: requestParams,
  })

  const { url, method, headers, body } = adapter.buildGenerateRequest(config, requestParams)
  logTaskProgress('AudioTask', 'request', {
    provider: config.provider,
    voice: requestParams.voice,
    method,
    url: redactUrl(url),
    model: requestParams.model,
  })
  logTaskPayload('AudioTask', 'request payload', {
    method,
    url,
    headers,
    body,
  })

  let resp: Response
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })
  } catch (err: any) {
    const detail = describeFetchError(err)
    logTaskError('AudioTask', 'tts-fetch', {
      provider: config.provider,
      voice: requestParams.voice,
      url: redactUrl(url),
      error: detail,
    })
    throw new Error(`TTS 请求失败：${detail}`)
  }

  if (!resp.ok) {
    const errText = await resp.text()
    logTaskError('AudioTask', 'tts-generate', { provider: config.provider, voice: requestParams.voice, status: resp.status, error: errText })
    throw new Error(`TTS API error ${resp.status}: ${errText}`)
  }

  const result = await resp.json()
  const parsed = adapter.parseResponse(result)

  // 将 hex 解码为二进制
  const buffer = Buffer.from(parsed.audioHex, 'hex')

  // 保存到本地
  const audioDir = path.join(STORAGE_ROOT, 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const filename = `${uuid()}.${parsed.format || 'mp3'}`
  const filePath = path.join(audioDir, filename)
  fs.writeFileSync(filePath, buffer)

  const relativePath = `static/audio/${filename}`
  logTaskSuccess('AudioTask', 'tts-saved', {
    provider: config.provider,
    voice: requestParams.voice,
    path: relativePath,
    bytes: buffer.length,
    audioMs: parsed.audioLength,
  })
  return relativePath
}

async function concatAudioFiles(paths: string[]): Promise<string> {
  const validPaths = paths.filter(Boolean)
  if (validPaths.length === 1) return validPaths[0]

  const tempDir = path.join(STORAGE_ROOT, 'temp')
  const audioDir = path.join(STORAGE_ROOT, 'audio')
  fs.mkdirSync(tempDir, { recursive: true })
  fs.mkdirSync(audioDir, { recursive: true })

  const listPath = path.join(tempDir, `${uuid()}.txt`)
  const outputFilename = `${uuid()}.mp3`
  const outputPath = path.join(audioDir, outputFilename)
  fs.writeFileSync(
    listPath,
    validPaths.map(item => `file '${toAbsPath(item).replace(/'/g, "'\\''")}'`).join('\n'),
    'utf-8',
  )

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:a', 'libmp3lame', '-b:a', '128k'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run()
  })

  try { fs.unlinkSync(listPath) } catch {}
  return `static/audio/${outputFilename}`
}

export async function generateDialogueTTS(params: {
  segments: DialogueSegment[]
  configId?: number | null
  resolveVoice?: (speaker: string) => { voiceStyle: string; voiceProvider: string }
}): Promise<string> {
  const paths: string[] = []
  for (const segment of params.segments) {
    const resolved = params.resolveVoice?.(segment.speaker) || { voiceStyle: '', voiceProvider: '' }
    console.log('[DEBUG resolveVoice]', segment.speaker, '=>', JSON.stringify(resolved))
    const audioPath = await generateTTS({
      text: segment.text,
      voice: resolved.voiceStyle,
      voiceProvider: resolved.voiceProvider,
      emotion: segment.emotion,
      speed: segment.speed,
      configId: params.configId,
    })
    paths.push(audioPath)
  }
  return concatAudioFiles(paths)
}

/**
 * 为角色生成试听音频
 */
export async function generateVoiceSample(characterName: string, voiceId: string, configId?: number | null): Promise<string> {
  const sampleText = `你好，我是${characterName}。很高兴认识你，这是我的声音试听。`
  return generateTTS({ text: sampleText, voice: voiceId, configId })
}
