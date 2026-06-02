/**
 * 批量生成接口 — POST /dramas/:id/batch-generate
 * 遍历 drama 下所有有 script_content 但未生成视频的 episodes
 * 依次执行：角色提取 → 分镜 → 图片生成 → 视频生成 → TTS → 合成 → 整集拼接
 * 返回批量任务 ID，可轮询进度
 */
import { Hono } from 'hono'
import { eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { generateVideo } from '../services/video-generation.js'
import { injectCharacterReferences } from '../services/character-consistency.js'
import { composeStoryboard } from '../services/ffmpeg-compose.js'
import { mergeEpisodeVideos } from '../services/ffmpeg-merge.js'
import { createAgent } from '../agents/index.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// Batch task in-memory store (keyed by taskId)
// In production this should be Redis or DB table
interface EpisodeTask {
  episodeId: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  error?: string
  step?: string
  failedStoryboardIds?: number[]  // Track failed storyboard IDs for retry
}

interface BatchTask {
  id: string
  dramaId: number
  status: 'running' | 'completed' | 'failed'
  total: number
  completed: number
  failed: number
  episodes: EpisodeTask[]
  createdAt: string
  error?: string
}

const batchTasks = new Map<string, BatchTask>()

function generateTaskId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getActiveConfigId(serviceType: string) {
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
    .all()
    .filter(row => row.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  return rows[0]?.id || null
}

// POST /dramas/:id/batch-generate
app.post('/', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const { skip_script_rewrite = false, bgm_path } = body

  // Verify drama exists
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '剧本不存在')

  // Find episodes with script_content but no videoUrl (or videoUrl is null)
  const allEps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .all()
    .filter(ep => !ep.deletedAt)

  const pendingEps = allEps.filter(ep =>
    ep.scriptContent && !ep.videoUrl && ep.generationStatus !== 'running'
  )

  if (pendingEps.length === 0) {
    return success(c, {
      message: 'No episodes ready for generation',
      drama_id: dramaId,
      total_episodes: allEps.length,
      ready_episodes: 0,
    })
  }

  const taskId = generateTaskId()
  const ts = now()

  // Initialize batch task
  const batchTask: BatchTask = {
    id: taskId,
    dramaId,
    status: 'running',
    total: pendingEps.length,
    completed: 0,
    failed: 0,
    episodes: pendingEps.map(ep => ({
      episodeId: ep.id,
      status: 'pending' as const,
    })),
    createdAt: ts,
  }
  batchTasks.set(taskId, batchTask)

  // Mark all episodes as running
  for (const ep of pendingEps) {
    db.update(schema.episodes)
      .set({ generationStatus: 'running', updatedAt: ts })
      .where(eq(schema.episodes.id, ep.id))
      .run()
  }

  // Launch background processing
  processBatchTask(taskId, pendingEps.map(e => e.id), { skip_script_rewrite, bgm_path }).catch(err => {
    logTaskError('BatchTask', 'process-fatal', { taskId, dramaId, error: err.message })
    const bt = batchTasks.get(taskId)
    if (bt) { bt.status = 'failed'; bt.error = err.message }
  })

  return created(c, {
    task_id: taskId,
    drama_id: dramaId,
    total: pendingEps.length,
    message: `Started batch generation for ${pendingEps.length} episodes`,
  })
})

// GET /dramas/:id/batch-generate/:taskId — Poll batch task progress
app.get('/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  const task = batchTasks.get(taskId)
  if (!task) return notFound(c, 'Batch task not found')

  const episodesWithStep = task.episodes.map(ep => ({
    episode_id: ep.episodeId,
    status: ep.status,
    step: ep.step || null,
    error: ep.error || null,
    failed_storyboard_ids: ep.failedStoryboardIds || [],
  }))

  return success(c, {
    task_id: task.id,
    drama_id: task.dramaId,
    status: task.status,
    total: task.total,
    completed: task.completed,
    failed: task.failed,
    progress: task.total > 0 ? Math.round((task.completed + task.failed) * 100 / task.total) : 0,
    episodes: episodesWithStep,
    created_at: task.createdAt,
    error: task.error,
  })
})

// DELETE /dramas/:id/batch-generate/:taskId — Cancel batch task
app.delete('/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  const task = batchTasks.get(taskId)
  if (!task) return notFound(c, 'Batch task not found')

  // Mark remaining pending episodes as pending again
  for (const ep of task.episodes) {
    if (ep.status === 'pending' || ep.status === 'running') {
      db.update(schema.episodes)
        .set({ generationStatus: 'pending', updatedAt: now() })
        .where(eq(schema.episodes.id, ep.episodeId))
        .run()
    }
  }
  task.status = 'failed'
  task.error = 'Cancelled by user'

  return success(c, { cancelled: taskId })
})

// POST /dramas/:id/batch-generate/:taskId/retry — Retry only failed storyboards
app.post('/:taskId/retry', async (c) => {
  const taskId = c.req.param('taskId')
  const body = await c.req.json()
  const { episode_id, storyboard_ids } = body

  const task = batchTasks.get(taskId)
  if (!task) return notFound(c, 'Batch task not found')

  // If episode_id provided, retry failed storyboards for that specific episode
  // Otherwise retry all failed storyboards across all episodes
  const targetEps = episode_id
    ? task.episodes.filter(e => e.episodeId === episode_id)
    : task.episodes.filter(e => e.status === 'failed')

  if (!targetEps.length) return success(c, { message: 'No failed storyboards to retry' })

  logTaskStart('BatchTask', 'retry-failed', { taskId, episodes: targetEps.map(e => e.episodeId) })

  for (const epTask of targetEps) {
    const failedIds = epTask.failedStoryboardIds || []
    if (!failedIds.length) continue

    logTaskProgress('BatchTask', 'retry-episode', {
      episodeId: epTask.episodeId,
      failedStoryboards: failedIds.length,
    })

    try {
      // Retry image generation for failed storyboards
      const sbs = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, epTask.episodeId))
        .all()
        .filter(sb => failedIds.includes(sb.id) && !sb.deletedAt)

      for (const sb of sbs) {
        if (!sb.firstFrameImage && !sb.composedImage) {
          // Need image first
          const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, epTask.episodeId)).all()
          const configId = ep?.imageConfigId || null
          const imgPrompt = sb.imagePrompt || sb.description || ''
          if (imgPrompt) {
            const imgId = await generateImage({
              storyboardId: sb.id,
              dramaId: ep?.dramaId,
              prompt: imgPrompt,
              frameType: 'first_frame',
              configId: configId || undefined,
            })
            await waitForImageGeneration(imgId, 600_000)
          }
        }
      }

      // Retry video generation for failed storyboards
      for (const sb of sbs) {
        if (!sb.videoUrl && (sb.firstFrameImage || sb.composedImage)) {
          const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, epTask.episodeId)).all()
          const configId = ep?.videoConfigId || null
          const imageUrl = sb.firstFrameImage || sb.composedImage || ''
          const videoId = await generateVideo(injectCharacterReferences({
            storyboardId: sb.id,
            dramaId: ep?.dramaId,
            prompt: sb.videoPrompt || sb.description || '',
            firstFrameUrl: imageUrl || undefined,
            referenceMode: imageUrl ? 'first_frame' : 'none',
            duration: sb.duration || 5,
            configId: configId || undefined,
          }, { force: true }))
          await waitForVideoGeneration(videoId, 600_000)
        }
      }

      // Retry compose for failed storyboards
      for (const sb of sbs) {
        if (sb.videoUrl && !sb.composedVideoUrl) {
          await composeStoryboard(sb.id)
        }
      }

      // Clear failed tracking on success
      epTask.failedStoryboardIds = []
      epTask.status = 'completed'
      epTask.step = 'retry_completed'
      db.update(schema.episodes)
        .set({ generationStatus: 'completed', updatedAt: now() })
        .where(eq(schema.episodes.id, epTask.episodeId))
        .run()

      logTaskSuccess('BatchTask', 'retry-episode-success', { episodeId: epTask.episodeId })
    } catch (err: any) {
      logTaskError('BatchTask', 'retry-episode-failed', {
        episodeId: epTask.episodeId,
        error: err.message,
      })
      // Keep existing failed storyboard IDs for next retry
    }
  }

  return success(c, {
    message: 'Retry initiated for failed storyboards',
    task_id: taskId,
  })
})

async function processBatchTask(
  taskId: string,
  episodeIds: number[],
  options: { skip_script_rewrite?: boolean; bgm_path?: string }
) {
  const bt = batchTasks.get(taskId)
  if (!bt) return

  for (let i = 0; i < episodeIds.length; i++) {
    const episodeId = episodeIds[i]
    const epTask = bt.episodes.find(e => e.episodeId === episodeId)
    if (!epTask) continue

    if (bt.status === 'failed' && !options.skip_script_rewrite) {
      // If previous episode failed and we're not in skip mode, stop
      break
    }

    epTask.status = 'running'
    epTask.step = 'starting'

    try {
      logTaskStart('BatchTask', `episode-${episodeId}`, {
        taskId,
        episodeId,
        progress: `${i + 1}/${episodeIds.length}`,
      })

      // Step 0: Script rewrite (only if no script_content)
      epTask.step = 'check_script'
      const [epForCheck] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
      if (!epForCheck?.scriptContent) {
        epTask.step = 'rewrite_script'
        await runScriptRewriter(episodeId, bt.dramaId)
      }

      // Step 1: Extract characters (if none exist for drama)
      epTask.step = 'extract_characters'
      await ensureCharactersForDrama(bt.dramaId, episodeId)

      // Step 2: Extract storyboards (agent call)
      epTask.step = 'extract_storyboards'
      await ensureStoryboardsForEpisode(episodeId, bt.dramaId)

      // Step 2.5: Voice assignment
      epTask.step = 'voice_assign'
      await runVoiceAssigner(episodeId, bt.dramaId)

      // Step 3: Generate images for all storyboards (with concurrency)
      epTask.step = 'generate_images'
      const imageConcurrency = Math.max(1, Number(process.env.IMAGE_CONCURRENCY || 3))
      await generateImagesForEpisode(episodeId, imageConcurrency)

      // Step 4: Generate videos for all storyboards (concurrent submission)
      epTask.step = 'generate_videos'
      await generateVideosForEpisode(episodeId)

      // Step 5: Compose storyboards (TTS + merge with video)
      epTask.step = 'compose_shots'
      await composeStoryboardsForEpisode(episodeId, epTask)

      // Step 6: Merge episode video
      epTask.step = 'merge_episode'
      const [epRecord] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
      const [dramaRecord] = db.select().from(schema.dramas).where(eq(schema.dramas.id, bt.dramaId)).all()
      const dramaStyle = dramaRecord?.style === 'anime' ? 'anime' : 'real'
      await mergeEpisodeVideosForEpisode(episodeId, bt.dramaId, {
        bgmPath: epRecord?.bgmPath || options.bgm_path || null,
        introPath: null,
        outroPath: null,
        style: dramaStyle,
      })

      // Step 7: Apply BGM if provided
      if (options.bgm_path) {
        epTask.step = 'apply_bgm'
        db.update(schema.episodes)
          .set({ bgmPath: options.bgm_path, updatedAt: now() })
          .where(eq(schema.episodes.id, episodeId))
          .run()
      }

      epTask.status = 'completed'
      epTask.step = 'done'
      db.update(schema.episodes)
        .set({ generationStatus: 'completed', updatedAt: now() })
        .where(eq(schema.episodes.id, episodeId))
        .run()

      bt.completed++
      logTaskSuccess('BatchTask', `episode-${episodeId}-complete`, {
        taskId,
        episodeId,
        progress: `${i + 1}/${episodeIds.length}`,
      })
    } catch (err: any) {
      epTask.status = 'failed'
      epTask.error = err.message
      epTask.step = 'failed'
      db.update(schema.episodes)
        .set({ generationStatus: 'failed', updatedAt: now() })
        .where(eq(schema.episodes.id, episodeId))
        .run()
      bt.failed++
      logTaskError('BatchTask', `episode-${episodeId}-failed`, {
        taskId,
        episodeId,
        error: err.message,
      })
      // Continue to next episode
    }
  }

  bt.status = bt.failed === bt.total ? 'failed' : 'completed'
  logTaskSuccess('BatchTask', 'batch-complete', {
    taskId,
    total: bt.total,
    completed: bt.completed,
    failed: bt.failed,
  })
}


async function runScriptRewriter(episodeId: number, dramaId: number) {
  try {
    const rewriter = createAgent('script_rewriter', episodeId, dramaId)
    if (!rewriter) throw new Error('script_rewriter agent not found')
    await rewriter.generate(
      [{ role: 'user', content: '请把当前集内容改写为标准短剧剧本格式（包含场景、动作、对白），要求强反转、爽点密集、节奏紧凑。' }],
      { maxSteps: 20 }
    )
    logTaskSuccess('BatchTask', 'script-rewritten', { episodeId })
  } catch (err: any) {
    logTaskError('BatchTask', 'script-rewrite', { episodeId, error: err.message })
    throw err
  }
}

async function runVoiceAssigner(episodeId: number, dramaId: number) {
  try {
    const assigner = createAgent('voice_assigner', episodeId, dramaId)
    if (!assigner) {
      logTaskProgress('BatchTask', 'voice-assigner-skipped', { episodeId, reason: 'agent not found' })
      return
    }
    await assigner.generate(
      [{ role: 'user', content: '请为当前集的所有角色分配合适的 AI 音色（参考 drama 的题材与角色性格）。' }],
      { maxSteps: 10 }
    )
    logTaskSuccess('BatchTask', 'voices-assigned', { episodeId })
  } catch (err: any) {
    logTaskError('BatchTask', 'voice-assign', { episodeId, error: err.message })
    // Non-fatal: continue without voice assignment
  }
}

async function ensureCharactersForDrama(dramaId: number, episodeId: number) {
  // Check if drama already has characters
  const existingChars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, dramaId))
    .all()
    .filter(c => !c.deletedAt)

  if (existingChars.length > 0) return

  // Run character extraction agent
  try {
    const extractor = createAgent('extractor', episodeId, dramaId)
    if (!extractor) throw new Error('extractor agent not found')
    await extractor.generate(
      [{ role: 'user', content: '请从剧本中提取所有角色信息，包括姓名、外貌特征、性格特点、声音风格。' }],
      { maxSteps: 15 }
    )
    logTaskSuccess('BatchTask', 'characters-extracted', { dramaId, episodeId })
  } catch (err: any) {
    logTaskError('BatchTask', 'character-extract', { dramaId, episodeId, error: err.message })
    // Non-fatal: continue without characters
  }
}

async function ensureStoryboardsForEpisode(episodeId: number, dramaId: number) {
  // Check if storyboards already exist
  const existingSBs = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
    .filter(sb => !sb.deletedAt)

  if (existingSBs.length > 0) return

  // Run storyboard breaker agent
  try {
    const breaker = createAgent('storyboard_breaker', episodeId, dramaId)
    if (!breaker) throw new Error('storyboard_breaker agent not found')
    await breaker.generate(
      [{ role: 'user', content: '请将当前集剧本拆解为分镜列表，包含每个镜头的场景、对白、画面描述。' }],
      { maxSteps: 20 }
    )
    logTaskSuccess('BatchTask', 'storyboards-extracted', { episodeId })
  } catch (err: any) {
    logTaskError('BatchTask', 'storyboard-extract', { episodeId, error: err.message })
    throw err
  }
}

async function generateImagesForEpisode(episodeId: number, concurrency: number) {
  const sbs = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
    .filter(sb => !sb.deletedAt && !sb.composedImage && !sb.firstFrameImage)

  if (sbs.length === 0) return

  // Get episode config
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  const configId = ep?.imageConfigId || null

  // Submit all image generation jobs (rate-limited queue)
  const pending: Promise<unknown>[] = []
  for (const sb of sbs) {
    const prompt = sb.imagePrompt || sb.description || ''
    if (!prompt) continue

    const p = generateImage({
      storyboardId: sb.id,
      dramaId: ep?.dramaId,
      prompt,
      frameType: 'first_frame',
      configId: configId || undefined,
    }).then(async (imgId) => {
      // Wait for completion via polling (image-generation.ts handles this)
      await waitForImageGeneration(imgId, 600_000)
    })
    pending.push(p)

    // Respect concurrency
    if (pending.length >= concurrency) {
      await Promise.race(pending)
      await new Promise(r => setTimeout(r, 1000)) // Brief pause between batches
    }
  }

  await Promise.all(pending)
}

async function waitForImageGeneration(imageId: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const [record] = db.select().from(schema.imageGenerations)
      .where(eq(schema.imageGenerations.id, imageId)).all()
    if (!record) return
    if (record.status === 'completed') return
    if (record.status === 'failed') throw new Error(record.errorMsg || 'Image generation failed')
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error('Image generation timeout')
}

async function generateVideosForEpisode(episodeId: number) {
  const sbs = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
    .filter(sb => !sb.deletedAt && !sb.videoUrl && (sb.composedImage || sb.firstFrameImage))

  if (sbs.length === 0) return

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  const configId = ep?.videoConfigId || null

  // Submit all video generation jobs concurrently
  const videoPromises: Promise<unknown>[] = []
  for (const sb of sbs) {
    const imageUrl = sb.firstFrameImage || sb.composedImage || ''
    const prompt = sb.videoPrompt || sb.description || ''

    const p = generateVideo(injectCharacterReferences({
      storyboardId: sb.id,
      dramaId: ep?.dramaId,
      prompt,
      firstFrameUrl: imageUrl || undefined,
      referenceMode: imageUrl ? 'first_frame' : 'none',
      duration: sb.duration || 5,
      configId: configId || undefined,
    }, { force: true })).then(async (videoId) => {
      await waitForVideoGeneration(videoId, 600_000)
    })
    videoPromises.push(p)
  }

  // Don't wait - let all videos generate in parallel
  await Promise.all(videoPromises)
}

async function waitForVideoGeneration(videoId: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const [record] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, videoId)).all()
    if (!record) return
    if (record.status === 'completed') return
    if (record.status === 'failed') throw new Error(record.errorMsg || 'Video generation failed')
    await new Promise(r => setTimeout(r, 10000))
  }
  throw new Error('Video generation timeout')
}

async function composeStoryboardsForEpisode(episodeId: number, episodeTaskRef?: { failedStoryboardIds?: number[] }) {
  const sbs = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
    .filter(sb => !sb.deletedAt && sb.videoUrl && !sb.composedVideoUrl)

  for (const sb of sbs) {
    try {
      await composeStoryboard(sb.id)
    } catch (err: any) {
      logTaskError('BatchTask', 'compose-storyboard', { storyboardId: sb.id, error: err.message })
      // Track failed storyboard
      if (episodeTaskRef) {
        episodeTaskRef.failedStoryboardIds = episodeTaskRef.failedStoryboardIds || []
        episodeTaskRef.failedStoryboardIds.push(sb.id)
      }
      throw err
    }
  }
}

async function mergeEpisodeVideosForEpisode(
  episodeId: number,
  dramaId: number,
  options?: { bgmPath?: string | null; introPath?: string | null; outroPath?: string | null; style?: 'anime' | 'real' }
) {
  try {
    await mergeEpisodeVideos(episodeId, dramaId, options)
  } catch (err: any) {
    logTaskError('BatchTask', 'merge-episode', { episodeId, error: err.message })
    throw err
  }
}

export { batchTasks }
export { processBatchTask }

export default app
