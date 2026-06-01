/**
 * Reviewer Agent 工具
 * compliance_reviewer + comparative_reviewer 共用
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'

export function createReviewTools(episodeId: number) {
  const readEpisodeScript = createTool({
    id: 'read_episode_script',
    description: '读取当前集剧本内容，用于审核',
    inputSchema: z.object({}),
    execute: async () => {
      const [ep] = db.select().from(schema.episodes)
        .where(eq(schema.episodes.id, episodeId)).all()
      if (!ep) return { error: `Episode not found (id=${episodeId})` }
      const content = ep.content || ep.scriptContent
      if (!content) return { error: `Episode has no content (id=${episodeId})` }
      return { content, word_count: content.length, episode_id: episodeId }
    },
  })

  const readRewrittenScript = createTool({
    id: 'read_rewritten_script',
    description: '读取AI改写后的剧本内容',
    inputSchema: z.object({}),
    execute: async () => {
      const [ep] = db.select().from(schema.episodes)
        .where(eq(schema.episodes.id, episodeId)).all()
      if (!ep) return { error: `Episode not found (id=${episodeId})` }
      const scriptContent = ep.scriptContent || ep.content
      if (!scriptContent) return { error: `Episode has no rewritten script (id=${episodeId})` }
      return { scriptContent, word_count: scriptContent.length, episode_id: episodeId }
    },
  })

  return {
    readEpisodeScript,
    readRewrittenScript,
  }
}