/**
 * Phase 1.1 新增 schema：9:16 竖屏 / BGM 库 / 封面模板 / 提示词模板 / 任务队列 / 一键生成
 */
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

// BGM 库：情绪化背景音乐管理
export const bgmLibrary = sqliteTable('bgm_library', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id'),
  name: text('name').notNull(),
  category: text('category'),       // 古风/现代/玄幻/热血/悲伤/紧张
  mood: text('mood'),                // tense/sad/inspiring/mysterious/romantic
  filePath: text('file_path').notNull(),
  duration: real('duration'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (t) => ({
  dramaIdx: index('idx_bgm_drama').on(t.dramaId),
  moodIdx: index('idx_bgm_mood').on(t.mood),
}))

// 封面模板：基于题材/风格的封面 prompt 库
export const coverTemplates = sqliteTable('cover_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  genre: text('genre'),
  style: text('style'),
  prompt: text('prompt'),
  negativePrompt: text('negative_prompt'),
  referenceImageUrl: text('reference_image_url'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// 提示词模板：可复用的剧本/分镜/视频 prompt 模板
export const promptTemplates = sqliteTable('prompt_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').notNull(), // script_rewrite / storyboard / video_prompt / etc.
  name: text('name').notNull(),
  template: text('template').notNull(),
  variables: text('variables'),        // JSON: list of variable names
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  categoryIdx: index('idx_prompt_templates_category').on(t.category),
}))

// 小说导入记录
export const novelImports = sqliteTable('novel_imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id'),
  sourceType: text('source_type'),     // url/paste/file
  sourceUrl: text('source_url'),
  sourceTitle: text('source_title'),
  rawContent: text('raw_content'),
  parsedChapters: text('parsed_chapters'), // JSON
  status: text('status').default('pending'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
})

// 通用任务队列（落表方案）
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),         // image_gen / video_gen / tts / compose / merge
  status: text('status').default('pending'), // pending/running/completed/failed
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  storyboardId: integer('storyboard_id'),
  payload: text('payload'),
  result: text('result'),
  errorMsg: text('error_msg'),
  priority: integer('priority').default(0),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  statusIdx: index('idx_tasks_status').on(t.status),
  typeIdx: index('idx_tasks_type').on(t.type),
  dramaIdx: index('idx_tasks_drama').on(t.dramaId),
}))

// 一键生成任务记录
export const oneClickTasks = sqliteTable('one_click_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id'),
  sourceType: text('source_type'),      // novel/url/paste
  sourceContent: text('source_content'),
  targetEpisodes: integer('target_episodes'),
  currentStep: text('current_step'),
  progress: integer('progress').default(0),
  status: text('status').default('pending'),
  result: text('result'),
  errorMsg: text('error_msg'),
  costTokens: integer('cost_tokens'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
