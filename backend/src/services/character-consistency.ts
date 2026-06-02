/**
 * 角色一致性 helper
 * 强制把分镜关联角色的 locked_image_url 作为参考图回灌到视频生成
 */
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export interface CharacterRefImage {
  characterId: number
  characterName: string
  imageUrl: string
  source: 'locked' | 'image' | 'reference'
}

/**
 * 取一个分镜关联的所有角色的"参考图"
 * 优先级：locked_image_url > reference_images[0] > image_url
 */
export function resolveStoryboardCharacterReferences(storyboardId: number): CharacterRefImage[] {
  const links = db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
    .all()
  if (!links.length) return []

  const charIds = links.map(l => l.characterId)
  const chars = db.select().from(schema.characters)
    .where(and(
      inArray(schema.characters.id, charIds),
      isNull(schema.characters.deletedAt),
    ))
    .all()

  const refs: CharacterRefImage[] = []
  for (const c of chars) {
    let imageUrl: string | null = null
    let source: CharacterRefImage['source'] = 'image'

    if (c.lockedImageUrl) {
      imageUrl = c.lockedImageUrl
      source = 'locked'
    } else if (c.referenceImages) {
      try {
        const refs = JSON.parse(c.referenceImages)
        if (Array.isArray(refs) && refs.length > 0) {
          imageUrl = refs[0]
          source = 'reference'
        }
      } catch {}
    }

    if (!imageUrl && c.imageUrl) {
      imageUrl = c.imageUrl
      source = 'image'
    }

    if (imageUrl) {
      refs.push({ characterId: c.id, characterName: c.name, imageUrl, source })
    }
  }

  return refs
}

/**
 * 把角色参考图注入到视频生成参数
 * 自动判断模式：1 张 = single，>1 张 = multiple
 */
export function injectCharacterReferences<T extends {
  storyboardId?: number
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  referenceImageUrls?: string[]
}>(params: T, opts: { force?: boolean } = {}): T {
  if (!params.storyboardId) return params
  if (!opts.force && params.referenceImageUrls && params.referenceImageUrls.length > 0) {
    return params // 调用方已显式提供参考图
  }

  const refs = resolveStoryboardCharacterReferences(params.storyboardId)
  if (!refs.length) return params

  return {
    ...params,
    referenceMode: refs.length === 1 ? 'single' : 'multiple',
    imageUrl: params.imageUrl || (refs.length === 1 ? refs[0].imageUrl : undefined),
    referenceImageUrls: refs.map(r => r.imageUrl),
  }
}
