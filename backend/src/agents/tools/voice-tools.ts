/**
 * 角色音色分配 Agent 工具
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'

export function createVoiceTools(episodeId: number, dramaId: number) {
  const minimaxFallbackVoices = [
    { id: 'male-qn-qingse', name: '青涩男声', gender: '男声', traits: '年轻自然', suitable_for: '青年男主、少年感角色、日常对白', language: 'zh', provider: 'minimax' },
    { id: 'male-qn-jingying', name: '精英男声', gender: '男声', traits: '稳重克制', suitable_for: '成熟男性、官员、叙事对白', language: 'zh', provider: 'minimax' },
    { id: 'male-qn-badao', name: '霸道男声', gender: '男声', traits: '强势压迫', suitable_for: '反派、权贵、强势人物', language: 'zh', provider: 'minimax' },
    { id: 'female-shaonv', name: '少女女声', gender: '女声', traits: '年轻明亮', suitable_for: '少女、年轻女性、惊恐对白', language: 'zh', provider: 'minimax' },
    { id: 'female-yujie', name: '御姐女声', gender: '女声', traits: '成熟冷静', suitable_for: '成熟女性、权谋角色、冷静对白', language: 'zh', provider: 'minimax' },
    { id: 'female-tianmei', name: '甜美女声', gender: '女声', traits: '甜润亲和', suitable_for: '温柔女性、轻松对白、配角', language: 'zh', provider: 'minimax' },
  ]
  const openAIFallbackVoices = [
    { id: 'alloy', name: 'Alloy', gender: '中性', traits: '平衡自然', suitable_for: '旁白、通用', language: '多语言' },
    { id: 'echo', name: 'Echo', gender: '男声', traits: '低沉稳重', suitable_for: '成熟男性、旁白', language: '多语言' },
    { id: 'fable', name: 'Fable', gender: '男声', traits: '温暖富有表现力', suitable_for: '年轻男性、故事叙述', language: '多语言' },
    { id: 'onyx', name: 'Onyx', gender: '男声', traits: '深沉有力', suitable_for: '权威角色、反派', language: '多语言' },
    { id: 'nova', name: 'Nova', gender: '女声', traits: '温柔甜美', suitable_for: '年轻女性、女主', language: '多语言' },
    { id: 'shimmer', name: 'Shimmer', gender: '女声', traits: '明亮活泼', suitable_for: '活泼女性、少女', language: '多语言' },
  ]

  function fallbackVoicesFor(provider: string) {
    return provider.toLowerCase() === 'minimax'
      ? minimaxFallbackVoices
      : openAIFallbackVoices.map(v => ({ ...v, provider }))
  }

  function getEpisodeAudioProvider() {
    const [episode] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
    if (!episode?.audioConfigId) return null
    const [config] = db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, episode.audioConfigId)).all()
    return config?.provider || null
  }

  const getCharacters = createTool({
    id: 'get_characters',
    description: 'Get all characters for the current drama with their current voice assignments.',
    inputSchema: z.object({}),
    execute: async () => {
      const chars = db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)).all()
      const payload = {
        characters: chars.map(c => ({
          id: c.id,
          name: c.name,
          role: c.role,
          personality: c.personality,
          description: c.description,
          current_voice: c.voiceStyle || '未分配',
        })),
      }
      logTaskSuccess('VoiceTool', 'get-characters', { episodeId, dramaId, count: payload.characters.length })
      return payload
    },
  })

  const listVoices = createTool({
    id: 'list_voices',
    description: 'List all available voice options for TTS.',
    inputSchema: z.object({}),
    execute: async () => {
      const provider = getEpisodeAudioProvider() || 'minimax'
      let rows = db.select().from(schema.aiVoices).where(eq(schema.aiVoices.provider, provider)).all()
      // DB 为空时自动同步音色
      if (!rows.length) {
        rows = await syncMinimaxVoices(provider)
      }
      const voices = rows.length
        ? rows.map(v => {
          const desc = v.description ? JSON.parse(v.description) : []
          return {
            id: v.voiceId,
            name: v.voiceName,
            gender: inferGender(v.voiceName, desc),
            traits: Array.isArray(desc) && desc.length ? desc.slice(0, 2).join('、') : `${v.language || '多语言'}音色`,
            suitable_for: Array.isArray(desc) && desc.length > 2 ? desc.slice(2).join('、') : `${v.language || '通用'}角色`,
            language: v.language,
            provider,
          }
        })
        : fallbackVoicesFor(provider)

      const payload = {
        provider,
        voices,
        instruction: '根据角色的性别、性格、年龄来匹配最合适的音色，并且只能从当前集音频配置可用的音色列表中选择。',
      }
      logTaskSuccess('VoiceTool', 'list-voices', { episodeId, provider, count: payload.voices.length })
      return payload
    },
  })

  const assignVoice = createTool({
    id: 'assign_voice',
    description: 'Assign a voice to a character.',
    inputSchema: z.object({
      character_id: z.number().describe('Character ID'),
      voice_id: z.string().describe('Voice ID from list_voices'),
      reason: z.string().optional().describe('Why this voice fits'),
    }),
    execute: async ({ character_id, voice_id, reason }) => {
      const provider = getEpisodeAudioProvider() || 'minimax'
      logTaskProgress('VoiceTool', 'assign-begin', { episodeId, dramaId, characterId: character_id, voiceId: voice_id, provider, reason })
      db.update(schema.characters)
        .set({ voiceStyle: voice_id, voiceProvider: provider, voiceSampleUrl: null, updatedAt: now() })
        .where(eq(schema.characters.id, character_id))
        .run()
      logTaskSuccess('VoiceTool', 'assign-complete', { episodeId, characterId: character_id, voiceId: voice_id, provider })
      return { message: `Assigned voice "${voice_id}" to character ${character_id}`, reason }
    },
  })

  return { getCharacters, listVoices, assignVoice }
}

function inferGender(name: string, desc: unknown) {
  const description = Array.isArray(desc) ? desc.join(' ') : ''
  const text = `${name} ${description}`
  if (/[男|青年|大爷|学长|boy|man|male]/i.test(text)) return '男声'
  if (/[女|少女|御姐|奶奶|girl|woman|female]/i.test(text)) return '女声'
  return '中性'
}

/**
 * 自动同步 MiniMax 音色到数据库（供 listVoices 在 DB 为空时调用）
 */
async function syncMinimaxVoices(provider: string) {
  if (provider !== 'minimax') return []

  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'audio'))
    .all()
    .filter(r => r.isActive && r.provider === 'minimax' && r.apiKey)

  if (!rows.length) return []

  const config = rows[0]
  const baseUrl = config.baseUrl || 'https://api.minimax.io'

  const resp = await fetch(`${baseUrl}/v1/t2a_v2/voice_list`, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!resp.ok) return []

  const result = await resp.json() as any
  const voices = (result.data?.system_voice || []) as any[]

  const ts = now()
  db.delete(schema.aiVoices).where(eq(schema.aiVoices.provider, 'minimax')).run()

  const insertRows = voices
    .filter((v: any) => {
      const lang = extractLang(v.voice_id, v.voice_name)
      if (lang !== '中文' && lang !== '粤语') return false
      const text = `${v.voice_id} ${v.voice_name}`.toLowerCase()
      const excluded = ['jingpin', '-beta', 'cartoon_pig', 'cute_boy', 'lovely_girl', 'clever_boy', 'robot_armor', 'news_anchor', 'male_announcer', 'radio_host', 'hk_flight_attendant']
      return !excluded.some(p => text.includes(p))
    })
    .map((v: any) => ({
      voiceId: v.voice_id,
      voiceName: v.voice_name,
      description: JSON.stringify(v.description || []),
      language: extractLang(v.voice_id, v.voice_name),
      provider: 'minimax',
      createdAt: ts,
    }))

  if (insertRows.length > 0) {
    db.insert(schema.aiVoices).values(insertRows).run()
  }

  return db.select().from(schema.aiVoices).where(eq(schema.aiVoices.provider, 'minimax')).all()
}

function extractLang(voiceId: string, voiceName: string): string {
  const text = `${voiceId} ${voiceName}`.toLowerCase()
  if (text.includes('cantonese') || text.includes('粤')) return '粤语'
  if (/^(male-qn-|female-|Chinese\s*\(Mandarin\)_)/i.test(voiceId)) return '中文'
  if (text.includes('chinese') || text.includes('mandarin') || text.includes('中文')) return '中文'
  return '其他'
}
