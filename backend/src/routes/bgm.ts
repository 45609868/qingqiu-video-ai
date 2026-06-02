/**
 * BGM 库管理
 * GET    /api/v1/bgm              - BGM 列表（支持按 mood/category/drama 过滤）
 * POST   /api/v1/bgm              - 新建 BGM
 * PATCH  /api/v1/bgm/:id          - 更新 BGM
 * DELETE /api/v1/bgm/:id          - 软删除
 * POST   /api/v1/bgm/assign       - 给 episode 分配 BGM
 */
import { Hono } from 'hono'
import { eq, and, isNull, like, or, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'

const app = new Hono()

const BGM_MOODS = ['tense', 'sad', 'inspiring', 'mysterious', 'romantic', 'epic', 'peaceful', 'comic'] as const
const BGM_CATEGORIES = ['古风', '现代', '玄幻', '热血', '悲伤', '紧张', '浪漫', '史诗', '恐怖', '喜剧'] as const

// GET /bgm
app.get('/', async (c) => {
  const mood = c.req.query('mood')
  const category = c.req.query('category')
  const dramaId = c.req.query('drama_id')

  const conditions = [isNull(schema.bgmLibrary.deletedAt)]
  if (mood) conditions.push(eq(schema.bgmLibrary.mood, mood))
  if (category) conditions.push(eq(schema.bgmLibrary.category, category))
  if (dramaId) conditions.push(eq(schema.bgmLibrary.dramaId, Number(dramaId)))

  const rows = db.select().from(schema.bgmLibrary)
    .where(and(...conditions))
    .orderBy(desc(schema.bgmLibrary.createdAt))
    .all()

  return success(c, rows.map(r => ({
    id: r.id,
    drama_id: r.dramaId,
    name: r.name,
    category: r.category,
    mood: r.mood,
    file_path: r.filePath,
    duration: r.duration,
    is_builtin: r.isBuiltin,
    is_active: r.isActive,
    created_at: r.createdAt,
  })))
})

// POST /bgm
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.name || !body?.filePath) return badRequest(c, 'name and file_path required')

  const ts = now()
  const res = db.insert(schema.bgmLibrary).values({
    name: body.name,
    dramaId: body.dramaId || null,
    category: body.category || null,
    mood: body.mood || null,
    filePath: body.filePath,
    duration: body.duration || null,
    isBuiltin: body.isBuiltin ?? false,
    isActive: body.isActive ?? true,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  return success(c, { id: Number(res.lastInsertRowid) })
})

// PATCH /bgm/:id
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null) as any
  if (!body) return badRequest(c, 'body required')

  const patch: any = { updatedAt: now() }
  if (body.name !== undefined) patch.name = body.name
  if (body.category !== undefined) patch.category = body.category
  if (body.mood !== undefined) patch.mood = body.mood
  if (body.filePath !== undefined) patch.filePath = body.filePath
  if (body.duration !== undefined) patch.duration = body.duration
  if (body.isActive !== undefined) patch.isActive = body.isActive

  const res = db.update(schema.bgmLibrary).set(patch)
    .where(eq(schema.bgmLibrary.id, id))
    .run()
  if (res.changes === 0) return notFound(c)

  return success(c, { id, updated: true })
})

// DELETE /bgm/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const res = db.update(schema.bgmLibrary)
    .set({ deletedAt: now(), isActive: false })
    .where(eq(schema.bgmLibrary.id, id))
    .run()
  if (res.changes === 0) return notFound(c)
  return success(c, { id, deleted: true })
})

// POST /bgm/assign - 给 episode 分配 BGM
app.post('/assign', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.episodeId || !body?.bgmId) return badRequest(c, 'episodeId and bgmId required')

  const [bgm] = db.select().from(schema.bgmLibrary)
    .where(eq(schema.bgmLibrary.id, body.bgmId)).all()
  if (!bgm) return notFound(c, 'BGM not found')

  const res = db.update(schema.episodes)
    .set({ bgmPath: bgm.filePath, updatedAt: now() })
    .where(eq(schema.episodes.id, body.episodeId))
    .run()
  if (res.changes === 0) return notFound(c, 'Episode not found')

  return success(c, { episodeId: body.episodeId, bgmId: body.bgmId, filePath: bgm.filePath })
})

// GET /bgm/meta - 情绪/分类元数据
app.get('/meta', (c) => {
  return success(c, {
    moods: BGM_MOODS,
    categories: BGM_CATEGORIES,
  })
})

export default app
