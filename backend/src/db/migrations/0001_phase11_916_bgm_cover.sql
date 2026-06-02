-- Migration: Phase 1.1 - 9:16 mobile-first + BGM + cover + subtitle style

-- 1. dramas: 9:16 + cover
ALTER TABLE dramas ADD COLUMN aspect_ratio TEXT DEFAULT '9:16';
ALTER TABLE dramas ADD COLUMN cover_prompt TEXT;
ALTER TABLE dramas ADD COLUMN cover_status TEXT DEFAULT 'pending';

-- 2. episodes: 9:16 + subtitle style
ALTER TABLE episodes ADD COLUMN aspect_ratio TEXT DEFAULT '9:16';
ALTER TABLE episodes ADD COLUMN subtitle_style TEXT;
ALTER TABLE episodes ADD COLUMN cover_url TEXT;
ALTER TABLE episodes ADD COLUMN total_duration REAL DEFAULT 0;
ALTER TABLE episodes ADD COLUMN storyboard_count INTEGER DEFAULT 0;

-- 3. image_generations: 9:16 default
ALTER TABLE image_generations ADD COLUMN aspect_ratio TEXT DEFAULT '9:16';

-- 4. storyboards: 9:16 + hook/retention metadata
ALTER TABLE storyboards ADD COLUMN aspect_ratio TEXT DEFAULT '9:16';
ALTER TABLE storyboards ADD COLUMN hook_score INTEGER;
ALTER TABLE storyboards ADD COLUMN retention_score INTEGER;
ALTER TABLE storyboards ADD COLUMN dialogue_text TEXT;

-- 5. characters: seed tracking
ALTER TABLE characters ADD COLUMN last_used_seed INTEGER;
ALTER TABLE characters ADD COLUMN consistency_seed INTEGER;

-- 6. new table: bgm_library
CREATE TABLE IF NOT EXISTS bgm_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  name TEXT NOT NULL,
  category TEXT,
  mood TEXT,
  file_path TEXT NOT NULL,
  duration REAL,
  is_builtin INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bgm_drama ON bgm_library(drama_id);
CREATE INDEX IF NOT EXISTS idx_bgm_mood ON bgm_library(mood);

-- 7. new table: cover_templates
CREATE TABLE IF NOT EXISTS cover_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  genre TEXT,
  style TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  reference_image_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 8. new table: prompt_templates
CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);

-- 9. new table: novel_imports (for 小说→视频)
CREATE TABLE IF NOT EXISTS novel_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  source_type TEXT,
  source_url TEXT,
  source_title TEXT,
  raw_content TEXT,
  parsed_chapters TEXT,
  status TEXT DEFAULT 'pending',
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

-- 10. new table: tasks (for batch/queue tracking)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  drama_id INTEGER,
  episode_id INTEGER,
  storyboard_id INTEGER,
  payload TEXT,
  result TEXT,
  error_msg TEXT,
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_drama ON tasks(drama_id);

-- 11. new table: one_click_tasks (一键生成任务记录)
CREATE TABLE IF NOT EXISTS one_click_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  source_type TEXT,
  source_content TEXT,
  target_episodes INTEGER,
  current_step TEXT,
  progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  result TEXT,
  error_msg TEXT,
  cost_tokens INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
