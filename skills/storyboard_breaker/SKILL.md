---
name: storyboard-breaker
description: 分镜拆解专业规范
---

# 分镜拆解指南

## 拆解原则

每个镜头聚焦**单一动作**，描述要详尽具体。每个镜头时长 10-30 秒，灵活设置。

## 镜头要素

1. **镜头标题**：3-5字概括核心内容（如"噩梦惊醒"）
2. **时间**：具体时分 + 光线描述
3. **地点**：场景完整描述 + 空间布局 + 环境细节
4. **景别**：远景/全景/中景/近景/特写
5. **角度**：平视/仰视/俯视/侧面/背面
6. **运镜**：固定/推镜/拉镜/摇镜/跟镜/移镜
7. **动作**：谁 + 具体怎么做 + 肢体细节 + 表情
8. **对话**：该镜头的完整对话（无则写"无"，禁止留空）
9. **画面结果**：动作的即时后果 + 视觉细节
10. **氛围**：光线 + 色调 + 声音 + 整体氛围
11. **时长**：10-30 秒灵活设置
12. **静态画面提示词**：`image_prompt`，用于首帧/尾帧/镜头图片生成（中文）
13. **视频提示词**：`video_prompt`，按时间段分片的视频生成描述（必须覆盖完整 duration）
14. **配乐提示词**：`bgm_prompt`，描述该镜头适合的配乐风格
15. **音效提示词**：`sound_effect`，描述该镜头关键环境音/动作音
16. **场景关联**：若能匹配已有场景，必须填写 `scene_id`
17. **角色关联**：填写 `character_ids`，绑定当前镜头涉及的 0 到多个角色

## video_prompt 格式要求（必须覆盖完整 duration）

每个镜头必须包含 `video_prompt` 字段，用于驱动 AI 视频生成：

**关键规则：video_prompt 必须覆盖整个 duration，不能截断。**

### 标准格式

```
0-{n}秒：<location>地点</location>，景别，角色动作+表情+台词。
<{n}-{m}>秒：<location>地点</location>，景别变化，角色反应+动作继续。
<{m}-{duration}>秒：<location>地点</location>，镜头收尾，结果呈现。
```

### 示例 - 14秒镜头

```
0-3秒：<location>长青宫内廷</location>，中景，陈妃挑起小春子下巴，笑容妩媚，问"本宫，好看吗？"。
3-6秒：<location>长青宫内廷</location>，近景，小春子满脸通红，脱口而出"好看"。
6-9秒：<location>长青宫内廷</location>，特写，陈妃笑容骤然冰冷，眼神如刀。
9-12秒：<location>长青宫内廷</location>，中景，李公公领命，挥手示意侍卫上前。
12-14秒：<location>长青宫内廷</location>，全景，侍卫拖走小春子，鲜血溅地，众人惊骇。
```

### 常见错误

❌ 只写到 9 秒，缺失最后 duration-9 秒内容

❌ 时间段重叠或跳跃

## 质量要求

- `description` 要适合人读，`video_prompt` 要适合模型生成，二者不要互相替代
- `image_prompt` 要突出单帧构图、角色外观、环境和光线（**使用中文**）
- `video_prompt` 要突出时间推进、动作变化、镜头语言，必须覆盖完整 duration
- `bgm_prompt` 和 `sound_effect` 用简洁短语即可，但不能空泛到只有"紧张""悲伤"
- 若存在旁白，统一写入 `dialogue`，格式为 `旁白：内容`
- `dialogue` 字段禁止留空，无台词则写"无"

## 使用步骤

1. 调用 `read_storyboard_context` 读取剧本、角色、场景、已有分镜摘要
2. 先基于剧本完成镜头拆解，确保总时长和叙事连续性合理
3. 为每个镜头补全完整字段：`title / shot_type / angle / movement / location / time / character_ids / action / dialogue / description / result / atmosphere / image_prompt / video_prompt / bgm_prompt / sound_effect / duration / scene_id`
4. **自检：video_prompt 是否覆盖完整 duration，dialogue 是否为空**
5. 调用 `save_storyboards` 一次性保存完整分镜
6. 如需调整，调用 `update_storyboard` 修改具体镜头

## 场景关联规则

- 优先使用 `read_storyboard_context` 返回的 `scenes`
- `location + time` 可明确匹配时，必须回填正确 `scene_id`
- 不要凭空生成不存在的场景 ID
- 如果剧本内容明显落在已有场景中，不要重复创造新场景描述

## 角色绑定规则

- `character_ids` 必须从 `read_storyboard_context` 返回的角色列表中选择
- 一个镜头可以没有角色，也可以绑定多个角色
- 只要镜头里有明确出场、被看见、发生动作或说话的角色，都应绑定进去
- 纯环境镜头、空镜头、物件镜头可以传空数组