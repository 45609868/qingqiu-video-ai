-- 索引优化：9:16 + BGM + 任务队列常用查询路径
CREATE INDEX IF NOT EXISTS idx_dramas_aspect ON dramas(aspect_ratio);
CREATE INDEX IF NOT EXISTS idx_episodes_drama_status ON episodes(drama_id, status);
CREATE INDEX IF NOT EXISTS idx_episodes_generation_status ON episodes(generation_status);
CREATE INDEX IF NOT EXISTS idx_storyboards_episode ON storyboards(episode_id);
CREATE INDEX IF NOT EXISTS idx_storyboards_status ON storyboards(status);
CREATE INDEX IF NOT EXISTS idx_image_gens_storyboard ON image_generations(storyboard_id);
CREATE INDEX IF NOT EXISTS idx_image_gens_status ON image_generations(status);
CREATE INDEX IF NOT EXISTS idx_video_gens_storyboard ON video_generations(storyboard_id);
CREATE INDEX IF NOT EXISTS idx_video_gens_status ON video_generations(status);
