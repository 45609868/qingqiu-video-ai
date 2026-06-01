import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { notFound, success } from '../utils/response.js'

const app = new Hono()

type HealthLevel = 'ok' | 'warning' | 'error'

function imageOf(item: any) {
  return item?.imageUrl || item?.localPath || item?.lockedImageUrl || ''
}

function hasFrame(sb: any) {
  return !!(sb.firstFrameImage || sb.lastFrameImage || sb.composedImage)
}

function hasDialogue(sb: any) {
  const text = String(sb.dialogue || '').trim()
  if (!text) return false
  return !/^(无|无对白|无台词|none|null|n\/a|na)$/i.test(text)
}

function latestByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(rows: T[], limit = 80) {
  return rows
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, limit)
}

function taskTarget(row: any, maps: any) {
  if (row.characterId) return { type: 'character', label: maps.characters.get(row.characterId)?.name || `角色 ${row.characterId}` }
  if (row.sceneId) return { type: 'scene', label: maps.scenes.get(row.sceneId)?.location || `场景 ${row.sceneId}` }
  if (row.storyboardId) {
    const sb = maps.storyboards.get(row.storyboardId)
    return { type: 'storyboard', label: sb ? `镜头 ${sb.storyboardNumber}${sb.title ? ` · ${sb.title}` : ''}` : `镜头 ${row.storyboardId}` }
  }
  return { type: 'drama', label: maps.drama?.title || `项目 ${row.dramaId || ''}`.trim() }
}

function normalizeTask(kind: string, row: any, maps: any) {
  const target = taskTarget(row, maps)
  return {
    id: `${kind}:${row.id}`,
    raw_id: row.id,
    kind,
    target_type: target.type,
    target_label: target.label,
    status: row.status || 'pending',
    provider: row.provider || '',
    model: row.model || '',
    prompt: row.prompt || '',
    error_msg: row.errorMsg || '',
    task_id: row.taskId || '',
    local_path: row.localPath || row.videoUrl || row.imageUrl || row.mergedUrl || '',
    created_at: row.createdAt || '',
    updated_at: row.updatedAt || row.completedAt || row.createdAt || '',
  }
}

app.get('/dramas/:dramaId/tasks', async (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const episodeId = Number(c.req.query('episode_id') || 0)
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, 'Drama not found')

  const storyboards = episodeId
    ? db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)).all()
    : db.select().from(schema.storyboards).all().filter(sb => {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      return ep?.dramaId === dramaId
    })
  const storyboardIds = new Set(storyboards.map(sb => sb.id))
  const characters = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
  const scenes = db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)).all()
  const maps = {
    drama,
    storyboards: new Map(storyboards.map(sb => [sb.id, sb])),
    characters: new Map(characters.map(ch => [ch.id, ch])),
    scenes: new Map(scenes.map(sc => [sc.id, sc])),
  }

  const imageRows = db.select().from(schema.imageGenerations).all()
    .filter(row => row.dramaId === dramaId && (!episodeId || !row.storyboardId || storyboardIds.has(row.storyboardId)))
  const videoRows = db.select().from(schema.videoGenerations).all()
    .filter(row => row.dramaId === dramaId && (!episodeId || !row.storyboardId || storyboardIds.has(row.storyboardId)))
  const mergeRows = db.select().from(schema.videoMerges).all()
    .filter(row => row.dramaId === dramaId && (!episodeId || row.episodeId === episodeId))

  const tasks = [
    ...imageRows.map(row => normalizeTask('image', row, maps)),
    ...videoRows.map(row => normalizeTask('video', row, maps)),
    ...mergeRows.map(row => normalizeTask('merge', row, maps)),
  ].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))

  return success(c, {
    items: tasks.slice(0, 120),
    summary: {
      total: tasks.length,
      running: tasks.filter(t => ['pending', 'processing'].includes(t.status)).length,
      failed: tasks.filter(t => t.status === 'failed').length,
      completed: tasks.filter(t => t.status === 'completed').length,
    },
  })
})

app.get('/dramas/:dramaId/health', async (c) => {
  const dramaId = Number(c.req.param('dramaId'))
  const episodeId = Number(c.req.query('episode_id') || 0)
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, 'Drama not found')

  const episodes = db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId)).all()
  const episode = episodeId ? episodes.find(ep => ep.id === episodeId) : episodes[0]
  const storyboards = episode ? db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episode.id)).all() : []
  const episodeCharIds = episode
    ? db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episode.id)).all().map(row => row.characterId)
    : []
  const characters = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
    .filter(ch => !ch.deletedAt && (!episodeCharIds.length || episodeCharIds.includes(ch.id)))
  const scenes = db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)).all().filter(sc => !sc.deletedAt)
  const links = db.select().from(schema.storyboardCharacters).all()
  const imageTasks = latestByUpdatedAt(db.select().from(schema.imageGenerations).all().filter(row => row.dramaId === dramaId), 30)
  const videoTasks = latestByUpdatedAt(db.select().from(schema.videoGenerations).all().filter(row => row.dramaId === dramaId), 30)

  const items: Array<{ level: HealthLevel; area: string; title: string; detail: string; action?: string }> = []
  const add = (level: HealthLevel, area: string, title: string, detail: string, action = '') => items.push({ level, area, title, detail, action })

  if (!episode) add('error', '剧集', '没有可制作剧集', '项目里还没有剧集数据。', '先创建剧集')
  if (episode && !episode.imageConfigId) add('warning', '配置', '未锁定图片模型', '镜头、角色和场景会使用全局默认图片模型，结果可能不稳定。', '在剧集顶部锁定图片模型')
  if (episode && !episode.videoConfigId) add('warning', '配置', '未锁定视频模型', '视频生成会使用全局默认视频模型。', '在剧集顶部锁定视频模型')
  if (episode && !episode.audioConfigId) add('warning', '配置', '未锁定音频模型', '配音会使用全局默认音频模型。', '在剧集顶部锁定音频模型')
  if (!characters.length) add('error', '角色', '没有角色资产', '镜头生成缺少角色参考。', '先从剧本提取角色')
  if (!scenes.length) add('error', '场景', '没有场景资产', '镜头生成缺少场景参考。', '先从剧本提取场景')
  if (!storyboards.length) add('error', '分镜', '没有分镜', '后续图片、视频和合成都没有制作对象。', '先拆解分镜')

  for (const ch of characters) {
    if (!imageOf(ch)) add('error', '角色', `${ch.name} 缺少标准图`, '镜头图生图无法稳定复用该角色。', '上传或生成角色图')
    if (!ch.referencePrompt) add('warning', '角色', `${ch.name} 缺少固定描述`, '模型只靠图片参考时，服装、年龄、发型容易漂。', '补充角色固定描述')
  }

  for (const sc of scenes) {
    if (!imageOf(sc)) add('warning', '场景', `${sc.location} 缺少标准图`, '绑定到该场景的镜头会缺少空间参考。', '上传或生成场景图')
    if (!sc.referencePrompt) add('warning', '场景', `${sc.location} 缺少固定描述`, '宫殿布局、光线和时代质感容易不一致。', '补充场景固定描述')
  }

  for (const sb of storyboards) {
    const charIds = links.filter(link => link.storyboardId === sb.id).map(link => link.characterId)
    if (!sb.sceneId) add('warning', '镜头', `镜头 ${sb.storyboardNumber} 未绑定场景`, '镜头生成不会自动拿到标准场景图。', '在分镜详情里选择场景')
    if (!charIds.length) add('warning', '镜头', `镜头 ${sb.storyboardNumber} 未绑定角色`, '镜头生成不会自动拿到角色参考图。', '在分镜详情里选择角色')
    if (!hasFrame(sb)) add('warning', '镜头', `镜头 ${sb.storyboardNumber} 缺少帧图`, '后续视频生成缺少首帧/尾帧。', '生成首帧或尾帧')
    if (hasDialogue(sb) && !sb.ttsAudioUrl) add('warning', '配音', `镜头 ${sb.storyboardNumber} 缺少配音`, '合成时不会带角色对白或旁白。', '生成配音')
    if (!sb.videoUrl) add('warning', '视频', `镜头 ${sb.storyboardNumber} 缺少视频`, '最终拼接前需要先生成镜头视频。', '生成视频')
  }

  for (const task of [...imageTasks, ...videoTasks].filter(row => row.status === 'failed').slice(0, 8)) {
    add('error', task.storyboardId ? '任务' : '资产任务', `任务 ${task.id} 失败`, task.errorMsg || '生成任务失败，建议改写提示词后重试。', '查看任务中心')
  }

  if (!items.length) add('ok', '项目', '制作链路完整', '角色、场景、分镜、配音、帧图和视频都已就绪。')
  const summary = {
    ok: items.filter(item => item.level === 'ok').length,
    warnings: items.filter(item => item.level === 'warning').length,
    errors: items.filter(item => item.level === 'error').length,
    total: items.length,
  }

  return success(c, { summary, items, generated_at: new Date().toISOString() })
})

export default app
