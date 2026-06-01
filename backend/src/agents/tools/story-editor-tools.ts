/**
 * 短剧总编 Agent 工具
 * 只读取当前集内容，不写入剧本，避免总编策略误覆盖生产稿。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'

export function createStoryEditorTools(episodeId: number, dramaId: number) {
  const readEpisodeSource = createTool({
    id: 'read_episode_source',
    description: 'Read current episode source content and basic drama metadata for story strategy analysis.',
    inputSchema: z.object({}),
    execute: async () => {
      const [ep] = db.select().from(schema.episodes)
        .where(eq(schema.episodes.id, episodeId)).all()
      if (!ep) return { error: `Episode not found (id=${episodeId})` }

      const [drama] = db.select().from(schema.dramas)
        .where(eq(schema.dramas.id, dramaId)).all()
      const content = ep.content || ep.scriptContent
      if (!content) return { error: `Episode has no content (id=${episodeId})` }

      return {
        drama_id: dramaId,
        drama_title: drama?.title || '',
        drama_style: drama?.style || '',
        episode_id: episodeId,
        episode_number: ep.episodeNumber,
        episode_title: ep.title,
        content,
        word_count: content.length,
      }
    },
  })

  return { readEpisodeSource }
}
