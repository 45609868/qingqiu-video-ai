import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, readImageAsCompressedDataUrl, saveBase64Image } from '../utils/storage.js'
import { getImageAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

type ImageQueueJob = {
  id: number
  config: AIConfig
}

const IMAGE_TASK_CONCURRENCY = Math.max(1, Number(process.env.IMAGE_TASK_CONCURRENCY || 1))
const IMAGE_TASK_DELAY_MS = Math.max(0, Number(process.env.IMAGE_TASK_DELAY_MS || 2000))
const IMAGE_TASK_MAX_RETRIES = Math.max(0, Number(process.env.IMAGE_TASK_MAX_RETRIES || 3))
const imageQueue: ImageQueueJob[] = []
let activeImageTasks = 0

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function enqueueImageGeneration(id: number, config: AIConfig) {
  imageQueue.push({ id, config })
  logTaskProgress('ImageTask', 'queued', {
    id,
    queueSize: imageQueue.length,
    active: activeImageTasks,
    concurrency: IMAGE_TASK_CONCURRENCY,
  })
  drainImageQueue()
}

function drainImageQueue() {
  while (activeImageTasks < IMAGE_TASK_CONCURRENCY && imageQueue.length) {
    const job = imageQueue.shift()!
    activeImageTasks++
    processImageGeneration(job.id, job.config)
      .catch(err => {
        logTaskError('ImageTask', 'process', { id: job.id, error: err.message })
        db.update(schema.imageGenerations)
          .set({ status: 'failed', errorMsg: err.message, updatedAt: now() })
          .where(eq(schema.imageGenerations.id, job.id))
          .run()
      })
      .finally(async () => {
        activeImageTasks--
        if (IMAGE_TASK_DELAY_MS > 0) await sleep(IMAGE_TASK_DELAY_MS)
        drainImageQueue()
      })
  }
}

function classifyRetry(status: number, bodyText: string) {
  const text = bodyText.toLowerCase()
  if (status === 429) return { retryable: true, baseDelayMs: 30_000, reason: 'rate_limit' }
  if (status >= 500) return { retryable: true, baseDelayMs: 10_000, reason: 'server_error' }
  if (text.includes('upstream error') || text.includes('do request failed') || text.includes('retry later')) {
    return { retryable: true, baseDelayMs: 10_000, reason: 'upstream_retryable' }
  }
  return { retryable: false, baseDelayMs: 0, reason: 'fatal' }
}

async function fetchWithRetry(id: number, request: RequestInit & { url: string }) {
  let lastError = ''

  for (let attempt = 0; attempt <= IMAGE_TASK_MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(request.url, {
        ...request,
        signal: AbortSignal.timeout(600_000),
      })

      if (resp.ok) return resp

      const bodyText = await resp.text()
      lastError = `API error ${resp.status}: ${bodyText}`
      const retry = classifyRetry(resp.status, bodyText)
      if (!retry.retryable || attempt >= IMAGE_TASK_MAX_RETRIES) {
        throw new Error(lastError)
      }

      const delayMs = retry.baseDelayMs * Math.pow(2, attempt)
      const retryMessage = `${retry.reason}: retrying in ${Math.round(delayMs / 1000)}s, attempt ${attempt + 1}/${IMAGE_TASK_MAX_RETRIES}`
      logTaskWarn('ImageTask', 'request-retry', {
        id,
        status: resp.status,
        reason: retry.reason,
        attempt: attempt + 1,
        maxRetries: IMAGE_TASK_MAX_RETRIES,
        delayMs,
      })
      db.update(schema.imageGenerations)
        .set({ status: 'processing', errorMsg: retryMessage, updatedAt: now() })
        .where(eq(schema.imageGenerations.id, id))
        .run()
      await sleep(delayMs)
    } catch (err: any) {
      lastError = err.message || stringifyError(err)
      const retryable = /fetch failed|timeout|network|ECONNRESET|ETIMEDOUT|upstream|retry later/i.test(lastError)
      if (!retryable || attempt >= IMAGE_TASK_MAX_RETRIES) throw new Error(lastError)

      const delayMs = 10_000 * Math.pow(2, attempt)
      logTaskWarn('ImageTask', 'request-retry', {
        id,
        error: lastError,
        attempt: attempt + 1,
        maxRetries: IMAGE_TASK_MAX_RETRIES,
        delayMs,
      })
      db.update(schema.imageGenerations)
        .set({ status: 'processing', errorMsg: `network retrying in ${Math.round(delayMs / 1000)}s, attempt ${attempt + 1}/${IMAGE_TASK_MAX_RETRIES}`, updatedAt: now() })
        .where(eq(schema.imageGenerations.id, id))
        .run()
      await sleep(delayMs)
    }
  }

  throw new Error(lastError || 'Image request failed')
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  const ts = now()
  const lockedConfig = params.configId
    ? getConfigById(params.configId, 'image')
    : null
  if (params.configId && !lockedConfig) {
    logTaskWarn('ImageTask', 'locked-config-fallback', { configId: params.configId, fallback: 'active-image-config' })
  }
  const config = lockedConfig || getActiveConfig('image')
  if (!config) throw new Error('No active image AI config')

  const res = db.insert(schema.imageGenerations).values({
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    prompt: params.prompt,
    model: params.model || config.model,
    provider: config.provider,
    size: params.size || '1080x1920',
    frameType: params.frameType,
    referenceImages: params.referenceImages ? JSON.stringify(params.referenceImages) : null,
    status: 'queued',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const lastId = Number(res.lastInsertRowid)
  logTaskStart('ImageTask', 'enqueue', {
    id: lastId,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id: lastId,
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })
  enqueueImageGeneration(lastId, config)
  return lastId
}

async function processImageGeneration(id: number, config: AIConfig) {
  const adapter = getImageAdapter(config.provider)

  try {
    const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
    const record = rows[0]
    if (!record) return
    db.update(schema.imageGenerations)
      .set({ status: 'processing', errorMsg: null, updatedAt: now() })
      .where(eq(schema.imageGenerations.id, id))
      .run()
    logTaskProgress('ImageTask', 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
      frameType: record.frameType,
    })

    // 使用 Adapter 构建请求
    const resolvedReferenceImages = await normalizeReferenceImages(record.referenceImages, config.provider)
    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      id: record.id,
      model: record.model,
      prompt: record.prompt,
      size: record.size,
      frameType: record.frameType,
      referenceImages: resolvedReferenceImages ? JSON.stringify(resolvedReferenceImages) : null,
    })
    logTaskProgress('ImageTask', 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })
    logTaskPayload('ImageTask', 'request payload', {
      id,
      method,
      url,
      headers,
      body: describeRequestBody(body),
    })

    const requestBody = body?.__multipart instanceof FormData
      ? body.__multipart
      : JSON.stringify(body)
    const resp = await fetchWithRetry(id, {
      url,
      method,
      headers,
      body: requestBody,
    })

    const result = await resp.json() as any
    logTaskPayload('ImageTask', 'response payload', {
      id,
      provider: config.provider,
      result,
    })

    const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && imageUrl) {
      logTaskProgress('ImageTask', 'sync-complete', { id, imageUrl })
      // 同步模式：直接下载图片
      await handleImageComplete(id, config.provider, imageUrl)
      return
    }

    if (!isAsync && !imageUrl) {
      // 同步模式但无 URL（Gemini 等返回 base64）
      const b64 = adapter.extractImageBase64(result)
      if (b64) {
        logTaskProgress('ImageTask', 'sync-base64-complete', { id, mimeType: b64.mimeType })
        await handleImageCompleteBase64(id, config.provider, b64.data, b64.mimeType)
        return
      }
      throw new Error('No image URL or base64 data in response')
    }

    // 异步模式：更新 taskId，开始轮询
    db.update(schema.imageGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.imageGenerations.id, id))
      .run()
    logTaskProgress('ImageTask', 'poll-start', { id, taskId, provider: config.provider })
    pollImageTask(id, config, taskId!)
  } catch (err: any) {
    logTaskError('ImageTask', 'process', { id, provider: config.provider, error: err.message })
    db.update(schema.imageGenerations)
      .set({ status: 'failed', errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.imageGenerations.id, id))
      .run()
  }
}

function describeRequestBody(body: any) {
  if (body?.__multipart instanceof FormData) {
    return {
      type: 'multipart/form-data',
      fields: Array.from(body.__multipart.keys()),
    }
  }
  return body
}

async function normalizeReferenceImages(raw: string | null | undefined, provider = ''): Promise<string[]> {
  if (!raw) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const isOpenAI = provider.toLowerCase() === 'openai'
  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('static/') || value.startsWith('/static/')) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: isOpenAI ? 512 : 768,
          maxHeight: isOpenAI ? 512 : 768,
          quality: isOpenAI ? 55 : 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, isOpenAI ? 4 : 6)
}

async function pollImageTask(id: number, config: AIConfig, taskId: string) {
  const adapter = getImageAdapter(config.provider)
  const startedAt = Date.now()
  const maxDurationMs = 600_000

  for (let i = 0; i < 120; i++) {
    if (Date.now() - startedAt >= maxDurationMs) {
      logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: 'Polling exceeded 10 minutes' })
      db.update(schema.imageGenerations)
        .set({ status: 'failed', errorMsg: 'Timeout: Polling exceeded 10 minutes', updatedAt: now() })
        .where(eq(schema.imageGenerations.id, id))
        .run()
      return
    }
    await new Promise(r => setTimeout(r, 5000))
    if (Date.now() - startedAt >= maxDurationMs) {
      logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: 'Polling exceeded 10 minutes' })
      db.update(schema.imageGenerations)
        .set({ status: 'failed', errorMsg: 'Timeout: Polling exceeded 10 minutes', updatedAt: now() })
        .where(eq(schema.imageGenerations.id, id))
        .run()
      return
    }
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress('ImageTask', 'poll-request', {
        id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const remainingMs = Math.max(1_000, maxDurationMs - (Date.now() - startedAt))
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(remainingMs),
      })
      if (!resp.ok) continue
      const result = await resp.json() as any

      const pollResp = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed' && pollResp.imageUrl) {
        logTaskSuccess('ImageTask', 'poll-complete', { id, taskId, imageUrl: pollResp.imageUrl })
        await handleImageComplete(id, config.provider, pollResp.imageUrl)
        return
      }
      if (pollResp.status === 'completed' && adapter.provider === 'gemini') {
        // Gemini 可能返回 base64
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskSuccess('ImageTask', 'poll-base64-complete', { id, taskId, mimeType: b64.mimeType })
          await handleImageCompleteBase64(id, config.provider, b64.data, b64.mimeType)
          return
        }
      }
      if (pollResp.status === 'failed') {
        const errorMsg = stringifyError(pollResp.error || 'Image generation failed')
        logTaskError('ImageTask', 'poll-failed', { id, taskId, error: errorMsg })
        db.update(schema.imageGenerations)
          .set({ status: 'failed', errorMsg, updatedAt: now() })
          .where(eq(schema.imageGenerations.id, id))
          .run()
        return
      }
    } catch (err: any) {
      if (i === 119 || Date.now() - startedAt >= maxDurationMs) {
        logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: err.message })
        db.update(schema.imageGenerations)
          .set({ status: 'failed', errorMsg: `Timeout: ${err.message}`, updatedAt: now() })
          .where(eq(schema.imageGenerations.id, id))
          .run()
        return
      }
      logTaskWarn('ImageTask', 'poll-retry', { id, taskId, attempt: i + 1, error: err.message })
    }
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

async function handleImageComplete(id: number, provider: string, imageUrl: string) {
  const localPath = await downloadFile(imageUrl, 'images')
  const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  const record = rows[0]

  db.update(schema.imageGenerations)
    .set({ imageUrl, localPath, status: 'completed', updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()
  logTaskSuccess('ImageTask', 'downloaded', { id, provider, localPath })

  // 更新关联表
  if (record?.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (record.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (record.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId)).run()
  }
  if (record?.characterId) {
    db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId)).run()
  }
  if (record?.sceneId) {
    db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId)).run()
  }
}

async function handleImageCompleteBase64(id: number, provider: string, base64Data: string, mimeType: string) {
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  const record = rows[0]

  db.update(schema.imageGenerations)
    .set({ localPath, status: 'completed', updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()
  logTaskSuccess('ImageTask', 'saved-base64', { id, provider, mimeType, localPath })

  // 更新关联表
  if (record?.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (record.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (record.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId)).run()
  }
  if (record?.characterId) {
    db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId)).run()
  }
  if (record?.sceneId) {
    db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId)).run()
  }
}
