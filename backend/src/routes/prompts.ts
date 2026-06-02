/**
 * 提示词模板管理
 * GET    /api/v1/prompts                  - 列表
 * POST   /api/v1/prompts                  - 新建
 * PATCH  /api/v1/prompts/:id              - 更新
 * DELETE /api/v1/prompts/:id              - 软删除
 * POST   /api/v1/prompts/render           - 渲染（用变量替换）
 */
import { Hono } from 'hono'
import { eq, and, isNull, desc, like } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'

const app = new Hono()

// GET /prompts
app.get('/', async (c) => {
  const category = c.req.query('category')
  const keyword = c.req.query('keyword')

  const conditions = [eq(schema.promptTemplates.isActive, true)]
  if (category) conditions.push(eq(schema.promptTemplates.category, category))
  if (keyword) conditions.push(like(schema.promptTemplates.name, `%${keyword}%`))

  const rows = db.select().from(schema.promptTemplates)
    .where(and(...conditions))
    .orderBy(desc(schema.promptTemplates.createdAt))
    .all()

  return success(c, rows.map(r => ({
    id: r.id,
    category: r.category,
    name: r.name,
    template: r.template,
    variables: r.variables ? JSON.parse(r.variables) : [],
    description: r.description,
  })))
})

// POST /prompts
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.category || !body?.name || !body?.template) {
    return badRequest(c, 'category, name, template required')
  }

  const ts = now()
  const res = db.insert(schema.promptTemplates).values({
    category: body.category,
    name: body.name,
    template: body.template,
    variables: body.variables ? JSON.stringify(body.variables) : null,
    description: body.description || null,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return success(c, { id: Number(res.lastInsertRowid) })
})

// PATCH /prompts/:id
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null) as any
  if (!body) return badRequest(c, 'body required')

  const patch: any = { updatedAt: now() }
  if (body.name !== undefined) patch.name = body.name
  if (body.template !== undefined) patch.template = body.template
  if (body.variables !== undefined) patch.variables = JSON.stringify(body.variables)
  if (body.description !== undefined) patch.description = body.description
  if (body.category !== undefined) patch.category = body.category

  const res = db.update(schema.promptTemplates).set(patch)
    .where(eq(schema.promptTemplates.id, id))
    .run()
  if (res.changes === 0) return notFound(c)
  return success(c, { id, updated: true })
})

// DELETE /prompts/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const res = db.update(schema.promptTemplates)
    .set({ isActive: false, updatedAt: now() })
    .where(eq(schema.promptTemplates.id, id))
    .run()
  if (res.changes === 0) return notFound(c)
  return success(c, { id, deleted: true })
})

// POST /prompts/render - 用变量替换渲染模板
app.post('/render', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body?.id || !body?.variables) return badRequest(c, 'id and variables required')

  const [tpl] = db.select().from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.id, body.id)).all()
  if (!tpl) return notFound(c, 'Template not found')

  let rendered = tpl.template
  for (const [k, v] of Object.entries(body.variables)) {
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v))
  }
  return success(c, { id: tpl.id, rendered })
})

export default app
