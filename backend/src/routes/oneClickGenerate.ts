/**
 * 一键端到端生成 — POST /dramas/:id/one-click-generate
 * 组合 import-novel + batch-generate
 * 用户只需上传小说txt或粘贴全文，点击一次，等结果
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { batchTasks } from './batchGenerate.js'
import { logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'

const app = new Hono()

// One-click task store (keyed by dramaId, one active task per drama)
interface OneClickTask {
  taskId: string       // batch task id
  dramaId: number
  novelContent: string
  status: 'importing' | 'generating' | 'completed' | 'failed'
  message?: string
  createdAt: string
}

const oneClickTasks = new Map<number, OneClickTask>()

// POST /dramas/:id/one-click-generate
app.post('/:id/one-click-generate', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const { novel_content, episode_title_prefix = '第', bgm_path } = body

  if (!novel_content || typeof novel_content !== 'string') {
    return badRequest(c, 'novel_content is required and must be a string')
  }

  // Check drama exists
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '剧本不存在')

  // Check if there's already an active one-click task
  const existing = oneClickTasks.get(dramaId)
  if (existing && existing.status === 'importing' || existing?.status === 'generating') {
    return badRequest(c, `One-click generation already in progress for this drama (task: ${existing.taskId}). Please wait or cancel it first.`)
  }

  logTaskStart('OneClick', 'start', { dramaId, novelLength: novel_content.length })

  // Check if drama already has episodes (skip import if yes)
  const existingEps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .all()
    .filter(ep => !ep.deletedAt)

  const needsImport = existingEps.length === 0 || !existingEps.some(ep => ep.scriptContent)

  if (needsImport) {
    // Phase 1: Import novel
    oneClickTasks.set(dramaId, {
      taskId: `oneclick_${dramaId}_${Date.now()}`,
      dramaId,
      novelContent: novel_content,
      status: 'importing',
      createdAt: now(),
    })

    try {
      // Split by === separator
      const rawChapters = novel_content.split(/===+/).filter(s => s.trim())
      if (rawChapters.length === 0) {
        throw new Error('No chapters found. Use === as chapter separator.')
      }

      const ts = now()
      const startNum = existingEps.length
        ? Math.max(...existingEps.map(e => e.episodeNumber)) + 1
        : 1

      // Get default config ids
      const imageRows = db.select().from(schema.aiServiceConfigs)
        .where(eq(schema.aiServiceConfigs.serviceType, 'image')).all()
        .filter(r => r.isActive)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      const videoRows = db.select().from(schema.aiServiceConfigs)
        .where(eq(schema.aiServiceConfigs.serviceType, 'video')).all()
        .filter(r => r.isActive)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      const audioRows = db.select().from(schema.aiServiceConfigs)
        .where(eq(schema.aiServiceConfigs.serviceType, 'audio')).all()
        .filter(r => r.isActive)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))

      for (let i = 0; i < rawChapters.length; i++) {
        const chapterText = rawChapters[i].trim()
        if (!chapterText) continue

        const lines = chapterText.split('\n')
        let title = ''
        let content = chapterText

        const firstLine = lines[0].trim()
        if (firstLine && !firstLine.startsWith('第')) {
          if (/^第[一二三四五六七八九十百千万\d]+[章节集]/.test(firstLine) || /^[《「『].+[》」』]/.test(firstLine)) {
            title = firstLine.replace(/^[=＝\s]+|[=＝\s]+$/g, '').trim()
            content = lines.slice(1).join('\n').trim()
          }
        }

        if (!title) {
          title = `${episode_title_prefix}${startNum + i}集`
        }

        db.insert(schema.episodes).values({
          dramaId,
          episodeNumber: startNum + i,
          title,
          content,
          status: 'draft',
          generationStatus: 'pending',
          imageConfigId: imageRows[0]?.id || null,
          videoConfigId: videoRows[0]?.id || null,
          audioConfigId: audioRows[0]?.id || null,
          createdAt: ts,
          updatedAt: ts,
        }).run()
      }

      const totalEps = db.select().from(schema.episodes)
        .where(eq(schema.episodes.dramaId, dramaId)).all().length
      db.update(schema.dramas)
        .set({ totalEpisodes: totalEps, updatedAt: ts })
        .where(eq(schema.dramas.id, dramaId)).run()

      logTaskSuccess('OneClick', 'import-complete', { dramaId, chapters: rawChapters.length })
    } catch (err: any) {
      const task = oneClickTasks.get(dramaId)
      if (task) { task.status = 'failed'; task.message = err.message }
      logTaskError('OneClick', 'import-failed', { dramaId, error: err.message })
      return badRequest(c, `Import failed: ${err.message}`)
    }
  }

  // Phase 2: Trigger batch generation
  const task = oneClickTasks.get(dramaId)
  if (task) task.status = 'generating'

  // Make internal call to batch-generate
  // We do this by directly dispatching since we're in the same process
  const { processBatchTask } = await import('./batchGenerate.js')

  const allEps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .all()
    .filter(ep => !ep.deletedAt && ep.scriptContent && !ep.videoUrl && ep.generationStatus !== 'running')

  if (allEps.length === 0) {
    const taskId = `batch_${Date.now()}_dummy`
    if (task) { task.status = 'completed'; task.message = 'All episodes already have videos' }
    return success(c, {
      drama_id: dramaId,
      status: 'completed',
      message: 'No episodes need video generation',
      episodes_total: allEps.length,
    })
  }

  const batchTaskId = `batch_${dramaId}_${Date.now()}`
  if (task) task.taskId = batchTaskId

  // Mark episodes as running
  for (const ep of allEps) {
    db.update(schema.episodes)
      .set({ generationStatus: 'running', updatedAt: now() })
      .where(eq(schema.episodes.id, ep.id)).run()
  }

  // Launch batch processing
  const { batchTasks: bt } = await import('./batchGenerate.js')

  const bt_entry: any = {
    id: batchTaskId,
    dramaId,
    status: 'running',
    total: allEps.length,
    completed: 0,
    failed: 0,
    episodes: allEps.map(ep => ({ episodeId: ep.id, status: 'pending' as const })),
    createdAt: now(),
  }
  bt.set(batchTaskId, bt_entry)

  processBatchTask(batchTaskId, allEps.map(e => e.id), { bgm_path }).catch((err: any) => {
    logTaskError('OneClick', 'batch-fatal', { dramaId, error: err.message })
    bt_entry.status = 'failed'
    bt_entry.error = err.message
    if (task) { task.status = 'failed'; task.message = err.message }
  })

  logTaskSuccess('OneClick', 'batch-started', { dramaId, batchTaskId, episodes: allEps.length })

  return created(c, {
    task_id: batchTaskId,
    drama_id: dramaId,
    status: 'generating',
    total_episodes: allEps.length,
    imported_chapters: needsImport ? (novel_content.split(/===+/).filter(s => s.trim()).length) : 0,
    message: `Started generating ${allEps.length} episodes`,
  })
})

// GET /dramas/:id/one-click-generate — Get one-click task status
app.get('/:id/one-click-generate', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const task = oneClickTasks.get(dramaId)

  if (!task) {
    // Check if there are any episodes being generated
    const eps = db.select().from(schema.episodes)
      .where(eq(schema.episodes.dramaId, dramaId))
      .all()
      .filter(ep => !ep.deletedAt)

    const runningEps = eps.filter(ep => ep.generationStatus === 'running')
    const completedEps = eps.filter(ep => ep.generationStatus === 'completed')
    const failedEps = eps.filter(ep => ep.generationStatus === 'failed')

    return success(c, {
      drama_id: dramaId,
      status: completedEps.length === eps.length && eps.length > 0 ? 'completed' : 'idle',
      episodes_total: eps.length,
      episodes_completed: completedEps.length,
      episodes_running: runningEps.length,
      episodes_failed: failedEps.length,
    })
  }

  // Get batch task status if available
  let batchStatus = null
  if (task.taskId && task.taskId.startsWith('batch_')) {
    const { batchTasks } = await import('./batchGenerate.js')
    batchStatus = batchTasks.get(task.taskId)
  }

  return success(c, {
    drama_id: dramaId,
    task_id: task.taskId,
    status: task.status,
    message: task.message,
    created_at: task.createdAt,
    batch: batchStatus ? {
      status: batchStatus.status,
      total: batchStatus.total,
      completed: batchStatus.completed,
      failed: batchStatus.failed,
      episodes: batchStatus.episodes,
    } : null,
  })
})

export default app
