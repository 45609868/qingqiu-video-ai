---
name: character-scene-extractor
description: 角色和场景提取的规范与方法
---

# 角色与场景提取指南

## 风格硬约束

全平台只支持两种风格，提取阶段就要为后续生图锁定视觉锚点：

- **anime** = 国漫古风玄幻（参考《万妖图录》《山海藏墟》《护镖人》《大天蓬》）
- **real** = 古装真人（参考大天蓬同类真人短剧）

**禁止** 第三种风格。若上游传来其他值，按 `anime` 处理。

---

## 角色提取规范

### 字段表

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 角色全名（古风用字、艺名、称号） |
| `role` | ✅ | `protagonist` / `supporting` / `extra` |
| `gender` | ✅ | 男 / 女 / 其他 |
| `age_range` | ✅ | 少年 / 青年 / 中年 / 老年 / 不老 |
| `appearance_cn` | ✅ | 中文外貌 300-500 字（面相/发型/体态/气质） |
| `personality_tags` | ✅ | 3-5 个核心性格标签 |
| `backstory` | ⬜ | 背景故事和关系 |
| `reference_prompt` | ✅ | **英文角色参考图 prompt（用于图生图一致性锚点）** |
| `voice_profile` | ⬜ | 音色建议（少年老成 / 御姐 / 霸道 / 少女） |
| `style` | ✅ | `anime` / `real`（锁死） |

### reference_prompt 模板（核心：防止后续漂移）

每个角色必须输出一段**英文锚点 prompt**，用于生成该角色的"参考脸"和后续图生图回灌。必须包含 5 类锚点：

```
a {gender} {age_range} {style_label} character,
{face_anchor}, {hair_anchor}, {costume_anchor}, {accessory_anchor},
{style_keywords}, {composition}, {quality_tags}
```

**5 类锚点拆解**：

1. **face_anchor**（面相锚点）：眉形 / 眼型 / 鼻型 / 唇型 / 脸型 / 肤色（例：`slender fox-like eyes, sharp jawline, porcelain skin`）
2. **hair_anchor**（发型发色锚点）：**发色必须写具体色名**（`ink-black` / `silver-white` / `dark brown` / `jade-green`），不能写 "long hair" 了事
3. **costume_anchor**（服装主色锚点）：**主色必须写具体色名 + 朝代 + 形制**（例：`ink-black hanfu with gold-trimmed collar, Tang dynasty`），不能只写 "ancient costume"
4. **accessory_anchor**（配饰锚点）：玉佩 / 发簪 / 面具 / 披风 / 武器（例：`jade pendant on waist, gold hairpin with phoenix`）
5. **composition + quality**：`portrait shot, head and upper torso, eye-level, neutral expression, 9:16 vertical aspect ratio, cinematic lighting, high detail, masterpiece`

### anime 风格关键词包（注入到 reference_prompt）

```
{style_label}: Chinese xianxia anime style / guofeng
{style_keywords}: ink-painting color palette, donghua style, 3D-to-2D shading, hand-painted texture, hongman line art, silk and satin fabric rendering, magical aura glow
```

### real 风格关键词包（注入到 reference_prompt）

```
{style_label}: Chinese costume live-action / period drama realism
{style_keywords}: cinematic photorealistic, studio lighting, period-accurate costume detail, film grain, shallow depth of field, 8K skin texture
```

### 错误 vs 正确示例

❌ 错误：
```
a male cultivator, handsome, wearing white robe, long hair, holding sword
```

✅ 正确（anime）：
```
a male young-adult Chinese xianxia anime character,
sharp sword-shaped brows, narrow phoenix eyes with amber irises, defined jawline, fair porcelain skin,
ink-black long hair tied in high topknot with loose strands framing the face,
ink-white hanfu robe with silver cloud-pattern embroidery, Tang dynasty silhouette, layered sleeves,
jade-green sword pendant at waist, ivory hairpin with carved lotus,
portrait shot, head and upper torso, eye-level, neutral calm expression,
9:16 vertical aspect ratio, ink-painting color palette, donghua style, hongman line art, hand-painted texture, masterpiece, high detail
```

✅ 正确（real）：
```
a male young-adult Chinese costume live-action character,
sharp sword-shaped brows, narrow phoenix eyes, defined jawline, weathered fair skin,
ink-black long hair tied in high topknot with realistic loose strands,
ink-white Tang dynasty hanfu with silver cloud-pattern embroidery on silk, layered sleeves,
jade-green sword pendant at waist, carved-ivory hairpin,
portrait shot, head and upper torso, eye-level, neutral calm expression,
9:16 vertical aspect ratio, cinematic photorealistic, period-accurate costume, studio key lighting, shallow DOF, 8K skin detail, film grain
```

### 锚点一致性铁律

- 同一角色在所有集、所有镜头的 `reference_prompt` 锚点必须一致（**只允许换构图、表情、运镜，不允许换发色、服装主色、配饰**）
- 锚点字段在第一次提取后写入 `characters.reference_prompt`，后续集直接复用，不再生成
- 若某集需要该角色"换装 / 受伤 / 中邪"，**新建第二个角色档案**（`{name}-injured`），不修改原锚点

---

## 场景提取规范

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 场景名（{地点}·{时间段}） |
| `location` | ✅ | 具体场所 |
| `time_of_day` | ✅ | 黎明 / 上午 / 午时 / 黄昏 / 夜晚 / 月夜 |
| `light_quality` | ✅ | 顺光 / 逆光 / 侧光 / 烛火 / 月光 / 雷光 |
| `atmosphere` | ✅ | 环境氛围 100-200 字 |
| `reference_prompt` | ✅ | **英文场景参考图 prompt（纯背景，不含人物）** |
| `style` | ✅ | `anime` / `real` |

### scene reference_prompt 模板

```
{scene_type} of {location}, {time_of_day}, {light_quality},
{atmosphere_keywords}, {architectural_anchors}, {weather_anchors},
{style_keywords}, empty scene no people, 9:16 vertical, {quality_tags}
```

- **scene_type**：`interior wide shot` / `exterior establishing shot` / `courtyard view` / `cave interior` 等
- **architectural_anchors**：飞檐 / 斗拱 / 雕花木窗 / 竹帘 / 石灯笼（anime）/ 朱漆大门 / 青砖灰瓦（real）
- **weather_anchors**：薄雾 / 落花 / 雨丝 / 月华 / 残阳
- **anime 关键词包**：`donghua background art, ink-painting atmosphere, dunhuang color palette, hand-painted texture, no people`
- **real 关键词包**：`cinematic photorealistic location shot, practical set design, atmospheric haze, period-accurate architecture, anamorphic lens, no people`

### 场景锚点铁律

- 同一场景所有镜头的 `reference_prompt` 锚点不变
- 场景参考图必须**先于人像图生成**（保证后续图生图背景一致）
- 严禁在场景图里塞人物

---

## 道具提取规范

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 道具名 |
| `type` | ✅ | 武器 / 法宝 / 服饰 / 交通 / 装饰 / 食物 / 书信 |
| `description` | ✅ | 外观 + 用途 |
| `reference_prompt` | ✅ | 英文道具 prompt（白底 / 单一物体） |
| `style` | ✅ | `anime` / `real` |

道具 prompt 模板：
```
a single {object}, {material}, {color}, {intricate_details},
{style_keywords}, white background, object close-up, 9:16 vertical, {quality_tags}
```

关键道具（主角武器 / 法宝 / 玉佩）必须出独立参考图，作为后续镜头复用锚点。

---

## 使用步骤

1. 调用 `read_script_for_extraction` 读取当前集剧本
2. 调用 `read_existing_characters` 查看项目已有角色（含 `reference_prompt`）和当前集已关联角色
3. 调用 `read_existing_scenes` 查看项目已有场景（含 `reference_prompt`）和当前集已关联场景
4. 调用 `read_style_hint` 读取本项目风格（`anime` / `real`），**全剧统一不变**
5. **只对未在项目中存在的角色 / 场景生成新 `reference_prompt`**，已存在的直接复用
6. 调用 `save_dedup_characters` 保存角色并自动关联到当前集
7. 调用 `save_dedup_scenes` 保存场景并自动关联到当前集

---

## 当前集规则

- 目标是补齐"当前集"需要的角色和场景，不是重扫整个项目
- 若角色或场景已在项目中存在但当前集未关联，仍应复用并关联到当前集
- 若项目中已有同名角色或同地点同时间场景，优先复用，不要重复创建
- **复用时 `reference_prompt` 一并复用，不允许重新生成**（防止锚点漂移）

---

## 自检清单（提取完成前必过）

- [ ] 全剧 `style` 字段只有 `anime` 或 `real`，没有第三种
- [ ] 每个角色都生成了 `reference_prompt`，含 5 类锚点
- [ ] 每个角色发色 / 服装主色 / 配饰都是具体色名 + 具体物名
- [ ] 每个场景都生成了 `reference_prompt`，纯背景无人物
- [ ] 道具 prompt 是白底单物体
- [ ] 同一角色 / 场景的 `reference_prompt` 在所有集里字字一致
- [ ] 没有把"港漫 / 三渲二 / 水墨 / 敦煌"作为独立风格写到 `style` 字段
