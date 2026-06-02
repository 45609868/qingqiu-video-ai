/**
 * FFmpeg 单镜头合成 — 视频 + TTS音频 + 烧录字幕
 */
import ffmpeg from 'fluent-ffmpeg'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { generateDialogueTTS } from './tts-generation.js'
import { parseDialogueSegments, resolveCharacterVoice, stringifySubtitleSegments } from './dialogue-utils.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')
let subtitleFilterSupport: boolean | null = null
const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

function getAudioDuration(filePath: string): number {
  try {
    const output = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf8' })
    return parseFloat(output.trim()) || 0
  } catch {
    return 0
  }
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function buildSrtFromSegments(segments: Array<{ speaker: string; text: string }>, audioPath: string): string {
  // Get individual clip durations by probing the concat audio file
  // We need per-segment timing: generate individual clips, probe them, then build SRT
  // For simplicity, estimate based on text length (avg ~4 chars/sec for Chinese TTS)
  let currentTime = 0
  const lines: string[] = []
  segments.forEach((seg, i) => {
    const charCount = seg.text.length
    const estimatedDuration = Math.max(1, charCount / 4)
    const endTime = currentTime + estimatedDuration
    const speakerPrefix = seg.speaker && seg.speaker !== '旁白' ? `${seg.speaker}：` : ''
    lines.push(`${i + 1}\n${formatSrtTime(currentTime)} --> ${formatSrtTime(endTime)}\n${speakerPrefix}${seg.text}\n`)
    currentTime = endTime + 0.2 // 0.2s gap between segments
  })
  return lines.join('\n')
}

function supportsSubtitleFilter(): boolean {
  if (subtitleFilterSupport != null) return subtitleFilterSupport
  try {
    const output = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' })
    subtitleFilterSupport = /\bsubtitles\b/.test(output)
  } catch {
    subtitleFilterSupport = false
  }
  return subtitleFilterSupport
}

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

/**
 * 合成单个镜头：视频 + TTS对白音频 + 烧录字幕
 */
export async function composeStoryboard(storyboardId: number): Promise<string> {
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)).all()
  if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)
  if (!sb.videoUrl) throw new Error(`Storyboard ${storyboardId} has no video`)
  db.update(schema.storyboards)
    .set({ status: 'compose_processing', composedVideoUrl: null, updatedAt: now() })
    .where(eq(schema.storyboards.id, storyboardId))
    .run()

  logTaskStart('ComposeTask', 'storyboard-compose', {
    storyboardId,
    storyboardNumber: sb.storyboardNumber,
    episodeId: sb.episodeId,
  })

  const videoPath = toAbsPath(sb.videoUrl)
  let audioPath: string | null = null
  let bgmPath: string | null = null
  let subtitlePath: string | null = null
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
  // 解析字幕样式
  let subtitleFontSize = 56
  let subtitleMarginV = 120
  let subtitleOutline = 4
  if (ep?.subtitleStyle) {
    try {
      const ss = JSON.parse(ep.subtitleStyle)
      if (typeof ss.fontSize === 'number') subtitleFontSize = ss.fontSize
      if (typeof ss.marginV === 'number') subtitleMarginV = ss.marginV
      if (typeof ss.outline === 'number') subtitleOutline = ss.outline
    } catch {}
  }
  const chars = ep ? db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all() : []
  if (ep?.bgmPath) {
    bgmPath = toAbsPath(ep.bgmPath)
  }
  const dialogueSegments = parseDialogueSegments(sb.dialogue, chars.map(char => char.name))

  // 1. 生成 TTS 音频（如果有对白）
  try {
    if (dialogueSegments.length) {
      if (sb.ttsAudioUrl) {
        const existingAudioPath = toAbsPath(sb.ttsAudioUrl)
        if (fs.existsSync(existingAudioPath)) {
          audioPath = existingAudioPath
        }
      }

      if (!audioPath) {
        logTaskProgress('ComposeTask', 'generate-inline-tts', {
          storyboardId,
          segments: dialogueSegments.length,
          textPreview: stringifySubtitleSegments(dialogueSegments).slice(0, 60),
        })
        const ttsPath = await generateDialogueTTS({
          segments: dialogueSegments,
          configId: ep?.audioConfigId ?? undefined,
          resolveVoice: speaker => resolveCharacterVoice(chars, speaker),
        })
        audioPath = toAbsPath(ttsPath)
        db.update(schema.storyboards).set({ ttsAudioUrl: ttsPath, updatedAt: now() })
          .where(eq(schema.storyboards.id, storyboardId)).run()
      }
    }

    // 2. 生成字幕文件（SRT）
    if (dialogueSegments.length && audioPath) {
      const srtDir = path.join(STORAGE_ROOT, 'subtitles')
      fs.mkdirSync(srtDir, { recursive: true })
      const srtFilename = `${uuid()}.srt`
      subtitlePath = path.join(srtDir, srtFilename)

      const totalDuration = getAudioDuration(audioPath) || (sb.duration || 10)
      const totalChars = dialogueSegments.reduce((sum, s) => sum + s.text.length, 0)
      let currentTime = 0
      const srtLines: string[] = []
      dialogueSegments.forEach((seg, i) => {
        const ratio = totalChars > 0 ? seg.text.length / totalChars : 1 / dialogueSegments.length
        const segDuration = totalDuration * ratio
        const startTime = currentTime
        const endTime = currentTime + Math.max(0.5, segDuration)
        currentTime = endTime + 0.15
        const speakerPrefix = seg.speaker && !IGNORE_TTS_SPEAKERS.test(seg.speaker) ? `${seg.speaker}：` : ''
        srtLines.push(
          `${i + 1}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${speakerPrefix}${seg.text}\n`
        )
      })
      const srtContent = srtLines.join('\n')
      fs.writeFileSync(subtitlePath, `\uFEFF${srtContent}`, 'utf-8')

      const srtRelative = `static/subtitles/${srtFilename}`
      db.update(schema.storyboards).set({ subtitleUrl: srtRelative, updatedAt: now() })
        .where(eq(schema.storyboards.id, storyboardId)).run()
    }

    // 3. FFmpeg 合成
    const outputDir = path.join(STORAGE_ROOT, 'composed')
    fs.mkdirSync(outputDir, { recursive: true })
    const outputFilename = `${uuid()}.mp4`
    const outputPath = path.join(outputDir, outputFilename)

    await new Promise<void>((resolve, reject) => {
      let cmd = ffmpeg(videoPath)

      if (audioPath) {
        cmd = cmd.input(audioPath)
      }
      if (bgmPath) {
        cmd = cmd.input(bgmPath)
      }

      const filters: string[] = []

      // 9:16 竖屏强制缩放 + 裁剪
      filters.push('scale=1080:1920:force_original_aspect_ratio=increase')
      filters.push('crop=1080:1920')

      // BGM 混音: 背景音乐音量 0.15，TTS音量 1.0
      const hasBgm = !!bgmPath
      const hasTts = !!audioPath
      if (hasBgm && hasTts) {
        // [0:a] = 视频自带音轨, [1:a] = TTS, [2:a] = BGM
        // BGM 需要 amix 之前先 loop 到视频长度
        filters.push('[2:a]aloop=loop=-1:size=2e9,atrim=0:' + (sb.duration || 10) + ',volume=0.15[bgm]')
        filters.push('[1:a]volume=1.0[tts]')
        filters.push('[tts][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]')
      } else if (hasBgm) {
        filters.push('[1:a]aloop=loop=-1:size=2e9,atrim=0:' + (sb.duration || 10) + ',volume=0.15[aout]')
      } else if (hasTts) {
        filters.push('[1:a]volume=1.0[aout]')
      } else {
        filters.push('[0:a]volume=1.0[aout]')
      }

      if (subtitlePath && supportsSubtitleFilter()) {
        const escapedPath = subtitlePath
          .replace(/\\/g, '/')
          .replace(/:/g, '\\:')
          .replace(/'/g, "\\'")
        // 9:16 竖屏字幕：字体60，底部居中，Outline=4 黑边
        const forceStyle = `FontSize=${subtitleFontSize}\\${','}PrimaryColour=&H00FFFFFF\\${','}OutlineColour=&H00000000\\${','}Outline=${subtitleOutline}\\${','}Alignment=2\\${','}MarginV=${subtitleMarginV}`
        filters.push(`subtitles=filename='${escapedPath}':force_style='${forceStyle}'`)
      } else if (subtitlePath) {
        logTaskProgress('ComposeTask', 'subtitle-filter-unavailable', {
          storyboardId,
          subtitlePath,
        })
      }

      if (filters.length > 0) {
        cmd = cmd.videoFilter(filters)
      }

      // Probe actual video and audio durations for sync
      const videoDuration = getAudioDuration(videoPath) || (sb.duration || 10)
      const audioDuration = audioPath ? getAudioDuration(audioPath) : null

      // Use H.265 encoding (libx265) for better compression
      // Use -shortest to handle mismatched video/audio durations
      const outputOptions = [
        '-map', '0:v:0',
        '-c:v', 'libx265',
        '-preset', 'medium',
        '-crf', '23',
        '-tag:v', 'hvc1',
        '-max_interleave_delta', '0.2',
      ]

      if (audioPath && audioDuration !== null) {
        // Ensure audio duration matches video (pad or truncate)
        if (audioDuration > videoDuration) {
          // Audio longer than video: pad video with last frame
          outputOptions.push('-stream_loop', '0', '-i', videoPath)
          outputOptions.push('-map', '1:v:0')
        }
        outputOptions.push('-map', '[aout]', '-c:a', 'aac', '-shortest')
      } else {
        outputOptions.push('-map', '[aout]', '-c:a', 'aac')
      }

      cmd.outputOptions(outputOptions)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    const composedRelative = `static/composed/${outputFilename}`
    db.update(schema.storyboards).set({ composedVideoUrl: composedRelative, status: 'compose_completed', updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId)).run()

    logTaskSuccess('ComposeTask', 'storyboard-compose', {
      storyboardId,
      storyboardNumber: sb.storyboardNumber,
      output: composedRelative,
    })
    return composedRelative
  } catch (err) {
    db.update(schema.storyboards)
      .set({ status: 'compose_failed', composedVideoUrl: null, updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))
      .run()
    throw err
  }
}
