/**
 * 小说导入接口 — POST /dramas/:id/import-novel
 * 按 === 分隔章节，每章节创建一个 episode
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

// POST /dramas/:id/import-novel
app.post('/:id/import-novel', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const { novel_content, episode_title_prefix = '第' } = body

  if (!novel_content || typeof novel_content !== 'string') {
    return badRequest(c, 'novel_content is required and must be a string')
  }

  // Check drama exists
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '剧本不存在')

  // Split by === separator
  const rawChapters = novel_content.split(/===+/).filter(s => s.trim())
  if (rawChapters.length === 0) {
    return badRequest(c, 'No chapters found. Use === as chapter separator.')
  }

  const ts = now()

  // Get existing episode count to determine starting number
  const existingEps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .all()
  const startNum = existingEps.length
    ? Math.max(...existingEps.map(e => e.episodeNumber)) + 1
    : 1

  // Get active config ids for new episodes
  const imageRows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'image'))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  const videoRows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  const audioRows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'audio'))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  const defaultImageConfigId = imageRows[0]?.id || null
  const defaultVideoConfigId = videoRows[0]?.id || null
  const defaultAudioConfigId = audioRows[0]?.id || null

  const createdEpisodes: any[] = []

  for (let i = 0; i < rawChapters.length; i++) {
    const chapterText = rawChapters[i].trim()
    if (!chapterText) continue

    // Extract title from first line (lines ending with ： or : or ===)
    const lines = chapterText.split('\n')
    let title = ''
    let content = chapterText

    // Try to parse title from first line
    const firstLine = lines[0].trim()
    if (firstLine && !firstLine.startsWith('第')) {
      // Check if first line looks like a chapter title
      if (/^第[一二三四五六七八九十百千万\d]+[章节集]/.test(firstLine) || /^[《「『].+[》」』]/.test(firstLine)) {
        title = firstLine.replace(/^[=＝\s]+|[=＝\s]+$/g, '').trim()
        content = lines.slice(1).join('\n').trim()
      }
    }

    // Fallback title
    if (!title) {
      title = `${episode_title_prefix}${startNum + i}集`
    }

    const res = db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: startNum + i,
      title,
      content,
      status: 'draft',
      generationStatus: 'pending',
      imageConfigId: defaultImageConfigId,
      videoConfigId: defaultVideoConfigId,
      audioConfigId: defaultAudioConfigId,
      createdAt: ts,
      updatedAt: ts,
    }).run()

    const [ep] = db.select().from(schema.episodes)
      .where(eq(schema.episodes.id, Number(res.lastInsertRowid))).all()
    createdEpisodes.push(toSnakeCase(ep))
  }

  // Update drama totalEpisodes
  const totalEps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .all().length
  db.update(schema.dramas)
    .set({ totalEpisodes: totalEps, updatedAt: ts })
    .where(eq(schema.dramas.id, dramaId))
    .run()

  return created(c, {
    drama_id: dramaId,
    imported: createdEpisodes.length,
    episodes: createdEpisodes,
  })
})

export default app
