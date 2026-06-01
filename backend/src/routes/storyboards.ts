import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateDialogueTTS } from '../services/tts-generation.js'
import { generateVideo } from '../services/video-generation.js'
import { composeStoryboard } from '../services/ffmpeg-compose.js'
import { parseDialogueSegments, resolveCharacterVoice, stringifySubtitleSegments } from '../services/dialogue-utils.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
    .run()

  const uniqueIds = [...new Set((characterIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    }).run()
  }
}

function getStoryboardCharacterIds(storyboardId: number) {
  return db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).all()
    .map(link => link.characterId)
}

function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined) {
  const episodeSceneIds = new Set(
    db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
      .map(link => link.sceneId),
  )
  const episodeCharacterIds = new Set(
    db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      .map(link => link.characterId),
  )

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  validateStoryboardBindings(body.episode_id, body.scene_id, body.character_ids)
  const res = db.insert(schema.storyboards).values({
    episodeId: body.episode_id,
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    action: body.action,
    dialogue: body.dialogue,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  syncStoryboardCharacters(Number(res.lastInsertRowid), body.character_ids || [])
  const [result] = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, Number(res.lastInsertRowid))).all()
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: getStoryboardCharacterIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [storyboard] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!storyboard) return badRequest(c, '镜头不存在')
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', action: 'action',
    dialogue: 'dialogue', duration: 'duration', video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
    first_frame_image: 'firstFrameImage', last_frame_image: 'lastFrameImage',
    composed_image: 'composedImage', reference_images: 'referenceImages',
  }

  const updates: Record<string, any> = { updatedAt: now() }
  for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
    if (snakeKey in body) updates[camelKey] = body[snakeKey]
  }

  if ('dialogue' in body) {
    updates.ttsAudioUrl = null
    updates.subtitleUrl = null
  }

  validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : getStoryboardCharacterIds(id),
  )

  db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id)).run()
  if ('character_ids' in body) syncStoryboardCharacters(id, body.character_ids || [])
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
  })
  return success(c)
})

// POST /storyboards/:id/generate-tts
app.post('/:id/generate-tts', async (c) => {
  const id = Number(c.req.param('id'))
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!sb) return badRequest(c, '镜头不存在')
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
  const chars = ep ? db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all() : []
  const segments = parseDialogueSegments(sb.dialogue, chars.map(char => char.name))
  if (!segments.length) return badRequest(c, '该镜头没有可生成的对白或旁白')
  logTaskStart('StoryboardAPI', 'generate-tts', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dialoguePreview: (sb.dialogue || '').slice(0, 40),
    segments: segments.length,
  })
  logTaskPayload('StoryboardAPI', 'generate-tts input', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dramaId: ep?.dramaId,
    chars: chars.map(c => ({ id: c.id, name: c.name, voiceStyle: c.voiceStyle, voiceProvider: c.voiceProvider })),
    dialogue: sb.dialogue,
    segments,
  })

  try {
    const audioPath = await generateDialogueTTS({
      segments,
      configId: ep?.audioConfigId || null,
      resolveVoice: speaker => resolveCharacterVoice(chars, speaker),
    })
    db.update(schema.storyboards)
      .set({ ttsAudioUrl: audioPath, updatedAt: now() })
      .where(eq(schema.storyboards.id, id))
      .run()

    logTaskSuccess('StoryboardAPI', 'generate-tts', {
      storyboardId: id,
      path: audioPath,
      textLength: segments.reduce((sum, item) => sum + item.text.length, 0),
      segments: segments.length,
    })
    return success(c, { tts_audio_url: audioPath, text: stringifySubtitleSegments(segments), segments })
  } catch (err: any) {
    logTaskError('StoryboardAPI', 'generate-tts', { storyboardId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id)).run()
  db.delete(schema.storyboards).where(eq(schema.storyboards.id, id)).run()
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

// POST /storyboards/:id/regenerate — 单镜头重新生成（视频+TTS+合成）
app.post('/:id/regenerate', async (c) => {
  const id = Number(c.req.param('id'))
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!sb) return badRequest(c, '镜头不存在')

  logTaskStart('StoryboardAPI', 'regenerate', {
    storyboardId: id,
    episodeId: sb.episodeId,
    storyboardNumber: sb.storyboardNumber,
  })

  try {
    // Reset generation status for this shot
    db.update(schema.storyboards)
      .set({
        videoUrl: null,
        ttsAudioUrl: null,
        subtitleUrl: null,
        composedVideoUrl: null,
        status: 'pending',
        updatedAt: now(),
      })
      .where(eq(schema.storyboards.id, id))
      .run()

    // Re-generate video first (requires image)
    if (sb.firstFrameImage || sb.composedImage) {
      const imageUrl = sb.firstFrameImage || sb.composedImage || ''
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      const configId = ep?.videoConfigId || null

      logTaskProgress('StoryboardAPI', 'regenerate-video', { storyboardId: id, imageUrl })
      const videoId = await generateVideo({
        storyboardId: id,
        dramaId: ep?.dramaId,
        prompt: sb.videoPrompt || sb.description || '',
        firstFrameUrl: imageUrl || undefined,
        referenceMode: imageUrl ? 'first_frame' : 'none',
        duration: sb.duration || 5,
        configId: configId || undefined,
      })
      await waitForVideoRegeneration(videoId, 600_000)
    }

    // Re-compose (video + TTS + subtitles)
    await composeStoryboard(id)

    const [updated] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
    logTaskSuccess('StoryboardAPI', 'regenerate', {
      storyboardId: id,
      videoUrl: updated?.videoUrl,
      composedVideoUrl: updated?.composedVideoUrl,
    })
    return success(c, {
      message: 'Regenerated successfully',
      storyboard_id: id,
      video_url: updated?.videoUrl,
      composed_video_url: updated?.composedVideoUrl,
    })
  } catch (err: any) {
    logTaskError('StoryboardAPI', 'regenerate', { storyboardId: id, error: err.message })
    db.update(schema.storyboards)
      .set({ status: 'failed', updatedAt: now() })
      .where(eq(schema.storyboards.id, id))
      .run()
    return badRequest(c, err.message)
  }
})

async function waitForVideoRegeneration(videoId: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const [record] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, videoId)).all()
    if (!record) return
    if (record.status === 'completed') return
    if (record.status === 'failed') throw new Error(record.errorMsg || 'Video generation failed')
    await new Promise(r => setTimeout(r, 10000))
  }
  throw new Error('Video regeneration timeout')
}

export default app
