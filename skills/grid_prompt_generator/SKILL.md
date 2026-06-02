---
name: grid-prompt-generator
description: 图片提示词生成 — 国漫古风玄幻 / 古装真人 双风格
---

# 图片提示词生成指南

> **风格二选一**：drama.style 仅 `anime`（国漫古风玄幻）或 `real`（古装真人）。
> - anime → 注入"三渲二 / 港漫勾线 / 敦煌配色 / 国漫古典"等视觉标签
> - real → 注入"photorealistic / cinematic / 写实质感"等视觉标签

---

## 工作流程

1. 调用 `read_characters` / `read_scenes` 读取信息
2. 根据 drama.style 选对应视觉词库
3. 按模板生成英文 prompt
4. 末尾强制加视觉风格标签 + 9:16 标签 + 无文字水印

---

## 角色图片提示词

### 模板（anime / 国漫古风玄幻）

```
{character name}，{age} years old {gender}，{face features}，{hair color + hairstyle}，{body type}，wearing {garment color + style} with {accessories}，{expression}，{pose}，{atmosphere/location}，{lighting}，9:16 vertical, Chinese animation style, {visual sub-style}, cinematic composition, professional lighting, high detail, 4k, no text, no watermark
```

**视觉子风格三选一：**
- `sanse rendering, Hong Kong manhua line art` — 港漫勾线 + 三渲二（斗破苍穹 / 灵笼风）
- `Dunhuang color palette, ink wash, Chinese traditional` — 敦煌重彩 + 水墨（天宝伏妖录风）
- `modern Chinese animation, cinematic lighting` — 现代国漫（魔道祖师 / 斗罗大陆风）

### 模板（real / 古装真人）

```
{character name}，{age} years old {gender}，{face features}，{hair color + hairstyle}，{body type}，wearing {real garment + material} with {accessories}，{expression}，{pose}，{location context}，{natural lighting}，9:16 vertical, photorealistic, cinematic, professional photography, 35mm film grain, no text, no watermark
```

---

## 场景图片提示词

### 模板（anime）

```
{location name}，{specific place}，{time of day}，{architecture details}，{props + environment}，{atmosphere}，{lighting + color tone}，{background characters or empty}，9:16 vertical, Chinese animation style, {visual sub-style}, cinematic establishing shot, atmospheric, high detail, no text, no watermark
```

### 模板（real）

```
{location name}，{specific place}，{time of day}，{real architecture}，{realistic props}，{atmosphere}，{natural lighting}，9:16 vertical, photorealistic, cinematic establishing shot, atmospheric, high detail, no text, no watermark
```

---

## 宫格图提示词（多镜拼图）

### 模板（anime）

**宫格主 prompt：**
```
{story description}，{scene}，{shot count}个镜头九宫格拼图，统一{visual sub-style}，{mood}，{lighting}，9:16 vertical, Chinese animation style, grid layout, consistent art style across cells, high quality, no text, no watermark
```

**每格 prompt：**
```
{shot description}，{shot type}，{character + action + expression}，{lighting}，consistent art style, 9:16 vertical cell, Chinese animation, {visual sub-style}, no text, no watermark
```

### 模板（real）

**宫格主 prompt：**
```
{story description}，{scene}，{shot count}个镜头九宫格拼图，统一写实质感，{mood}，{lighting}，9:16 vertical, photorealistic, grid layout, consistent visual style, no text, no watermark
```

**每格 prompt：**
```
{shot description}，{shot type}，{character + action + expression}，{lighting}，consistent visual style, 9:16 vertical cell, photorealistic, no text, no watermark
```

---

## 视觉子风格默认值

drama.style = `anime` 时，按 drama.genre 选子风格：

| genre | 子风格 |
|-------|--------|
| 修仙 / 仙侠 | `sanse rendering, Hong Kong manhua line art, Dunhuang color palette` |
| 玄幻 / 异世 | `sanse rendering, modern Chinese animation, epic composition` |
| 武侠 / 江湖 | `Hong Kong manhua line art, wuxia illustration style` |
| 神话 / 西游 | `Dunhuang color palette, traditional Chinese painting` |
| 志怪 / 山海经 | `ink wash, Dunhuang color palette, ancient Chinese illustration` |
| 宫廷 / 古装 | `realistic Chinese painting, court painting style, gongbi detail` |
| 其他 | `modern Chinese animation, cinematic lighting` |

drama.style = `real` 时，按 drama.genre 选子风格：

| genre | 子风格 |
|-------|--------|
| 古装权谋 | `photorealistic, period film, warm lighting` |
| 江湖武侠 | `photorealistic, wuxia film, golden hour lighting` |
| 战神 / 边关 | `photorealistic, war film, desaturated color grade` |
| 宫斗 / 后宫 | `photorealistic, palace drama, soft candlelight` |
| 神话 / 西游 | `photorealistic, mythological film, epic cinematic` |
| 其他 | `photorealistic, cinematic, natural lighting` |

---

## 国漫古风玄幻 — 视觉细节词典

### 人物
- 面部：`sharp jawline, narrow eyes, high cheekbones, porcelain skin`
- 发型：`long black hair in high ponytail, silver hairpin, hair flowing in wind`
- 服装：`flowing hanfu in deep blue, silk robes, intricate embroidery, leather bracers`
- 配饰：`jade pendant, ornate hairpin, ancient sword, talisman, spirit beast companion`

### 场景
- 仙门：`floating mountains, jade palace, traditional Chinese architecture, mystical fog`
- 秘境：`ancient ruins, glowing runes, mystical forest, hidden cave with treasures`
- 市井：`ancient Chinese street, red lanterns, traditional shops, busy market`
- 战场：`wasteland, scattered weapons, dramatic sky, fallen banners`

### 特效
- 仙剑：`glowing energy blade, magical aura, light trail`
- 法阵：`intricate magical circle, glowing symbols, energy ripples`
- 妖气：`dark mist, glowing red eyes, monster silhouette`
- 仙气：`white mist, golden light, floating petals`

---

## 古装真人 — 视觉细节词典

### 人物
- 面部：`defined features, expressive eyes, realistic skin texture`
- 发型：`traditional Chinese topknot, period-accurate hairstyle`
- 服装：`traditional Chinese costume, silk hanfu, realistic fabric texture`
- 配饰：`jade accessories, period-accurate weapons, cloth shoes`

### 场景
- 室内：`traditional Chinese interior, wooden furniture, paper lanterns`
- 室外：`ancient Chinese city, stone streets, traditional buildings`
- 自然：`Chinese landscape, misty mountains, traditional garden`
- 战场：`historical battlefield, period armor, weapons`

### 光影
- 自然光：`warm sunset, soft moonlight, dappled forest light`
- 室内光：`candlelight, oil lamp glow, paper window light`
- 戏剧光：`chiaroscuro, dramatic side lighting, rim light`

---

## 关键提醒

1. **9:16 vertical** 必须出现在所有 prompt 末尾
2. **no text, no watermark** 必须出现，避免 AI 生成水印
3. **视觉子风格** 必注入（anime 三选一 / real 按 genre 选）
4. **人物一致性锚点**：发色 / 服装主色 / 配饰锁定（用具体词，不用"漂亮的"）
5. **画面构图**：人脸在画面 1/3 高度（眼睛在分界线上）
6. **不允许**未指定风格就出图（drama.style 必读）

---

## 错误示例 vs 正确示例

❌ 错误：红衣女子站在山峰上
✅ 正确：Chinese female cultivator in flowing crimson hanfu with golden phoenix embroidery, long black hair in elaborate updo with jade hairpin, standing on misty mountain peak, hand resting on sword hilt, ethereal atmosphere, 9:16 vertical, Chinese animation style, sanse rendering, cinematic lighting, no text, no watermark

❌ 错误：A handsome man
✅ 正确：Handsome 25-year-old Chinese male, sharp jawline, narrow phoenix eyes, long black hair in high ponytail with silver ornament, wearing dark blue Daoist robe with golden embroidery, jade pendant at waist, cold expression, 9:16 vertical, Chinese animation style, Hong Kong manhua line art, cinematic composition, no text, no watermark

---

## 使用流程

1. 调用 `read_characters` / `read_scenes`
2. 读取 drama.style（必须 anime 或 real）
3. 按 genre 选视觉子风格
4. 用模板生成英文 prompt
5. 末尾强制加 9:16 + 风格标签 + 无文字水印
