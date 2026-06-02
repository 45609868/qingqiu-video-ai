/**
 * 封面生成 / 模板管理
 * GET    /api/v1/covers/templates        - 模板列表
 * POST   /api/v1/covers/templates        - 新建模板
 * POST   /api/v1/covers/generate         - 为 drama 生成封面（AI 异步）
 * GET    /api/v1/covers/drama/:id        - 取某剧的封面候选
 */
import { Hono } from 'hono'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { getImageAdapter } from '../services/adapters/registry.js'
import { logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'

const app = new Hono()

// GET /covers/templates
app.get('/templates', async (c) => {
  const genre = c.req.query('genre')
  const style = c.req.query('style')

  const conditions = [eq(schema.coverTemplates.isActive, true)]
  if (genre) conditions.push(eq(schema.coverTemplates.genre, genre))
  if (style) conditions.push(eq(schema.coverTemplates.style, style))

  const rows = db.select().from(schema.coverTemplates)
    .where(and(...conditions))
    .orderBy(desc(schema.coverTemplates.createdAt))
    .all()

  return success(c, rows)
})

// POST /covers/templates
app.post('/templates', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.name || !body?.prompt) return badRequest(c, 'name and prompt required')

  const ts = now()
  const res = db.insert(schema.coverTemplates).values({
    name: body.name,
    genre: body.genre || null,
    style: body.style || null,
    prompt: body.prompt,
    negativePrompt: body.negativePrompt || null,
    referenceImageUrl: body.referenceImageUrl || null,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  return success(c, { id: Number(res.lastInsertRowid) })
})

// POST /covers/generate - 给 drama 生成封面
app.post('/generate', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.dramaId) return badRequest(c, 'dramaId required')

  const [drama] = db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, body.dramaId)).all()
  if (!drama) return notFound(c, 'Drama not found')

  // 1) 选/构造 cover prompt
  let coverPrompt = body.prompt || drama.coverPrompt
  if (!coverPrompt) {
    const tpl = db.select().from(schema.coverTemplates)
      .where(eq(schema.coverTemplates.isActive, true))
      .all()
      .find(t => (t.genre === drama.genre || !t.genre) && (t.style === drama.style || !t.style))
    if (tpl) coverPrompt = tpl.prompt
  }
  if (!coverPrompt) coverPrompt = buildDefaultCoverPrompt(drama)

  // 2) 9:16 封面，size=1080x1920
  const config = body.configId ? getConfigById(body.configId, 'image') : getActiveConfig('image')
  if (!config) return badRequest(c, 'No active image AI config')

  const ts = now()
  // 3) 写 image_generations 记录（image_type=cover）
  const res = db.insert(schema.imageGenerations).values({
    dramaId: drama.id,
    imageType: 'cover',
    provider: config.provider,
    prompt: coverPrompt,
    model: config.model,
    size: '1080x1920',
    aspectRatio: '9:16',
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const genId = Number(res.lastInsertRowid)
  logTaskStart('CoverTask', 'generate', { dramaId: drama.id, genId })

  // 4) 调适配器生成
  void (async () => {
    try {
      const adapter = getImageAdapter(config.provider)
      const req = adapter.buildGenerateRequest(config, {
        id: genId,
        prompt: coverPrompt,
        model: config.model,
        size: '1080x1920',
        aspectRatio: '9:16',
      } as any)
      const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body ? JSON.stringify(req.body) : undefined })
      const data = await resp.json()
      const parsed = adapter.parseGenerateResponse(data)
      if (parsed.isAsync) {
        db.update(schema.imageGenerations).set({ taskId: parsed.taskId, updatedAt: now() })
          .where(eq(schema.imageGenerations.id, genId)).run()
      } else if (parsed.imageUrl) {
        const ts2 = now()
        db.update(schema.imageGenerations).set({
          imageUrl: parsed.imageUrl,
          status: 'completed',
          completedAt: ts2,
          updatedAt: ts2,
        }).where(eq(schema.imageGenerations.id, genId)).run()
        db.update(schema.dramas).set({
          thumbnail: parsed.imageUrl,
          coverStatus: 'completed',
          updatedAt: ts2,
        }).where(eq(schema.dramas.id, drama.id)).run()
      }
      logTaskSuccess('CoverTask', 'generate', { genId, dramaId: drama.id })
    } catch (err: any) {
      logTaskError('CoverTask', 'generate', { genId, error: err.message })
      db.update(schema.imageGenerations).set({ status: 'failed', errorMsg: err.message, updatedAt: now() })
        .where(eq(schema.imageGenerations.id, genId)).run()
      db.update(schema.dramas).set({ coverStatus: 'failed', updatedAt: now() })
        .where(eq(schema.dramas.id, drama.id)).run()
    }
  })()

  return success(c, { genId, dramaId: drama.id, prompt: coverPrompt })
})

// GET /covers/drama/:id
app.get('/drama/:id', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const covers = db.select().from(schema.imageGenerations)
    .where(and(
      eq(schema.imageGenerations.dramaId, dramaId),
      eq(schema.imageGenerations.imageType, 'cover'),
    ))
    .orderBy(desc(schema.imageGenerations.createdAt))
    .all()
  return success(c, covers)
})

function buildDefaultCoverPrompt(drama: typeof schema.dramas.$inferSelect): string {
  return [
    `微短剧封面图《${drama.title}》`,
    drama.style || 'anime',
    'epic composition, dramatic lighting, central focus',
    '9:16 vertical, ultra-detailed, 1080x1920',
    drama.description || '',
  ].filter(Boolean).join(', ')
}

export default app
