/**
 * FFmpeg 多镜头拼接 — 将所有合成后的镜头视频拼接为一集
 * 支持红果短剧标准转场：fade（动漫）/ dissolve（真人）
 * 使用 acrossfade 替代 xfade，更适合音频平滑过渡
 */
import ffmpeg from 'fluent-ffmpeg'
import { exec as execCallback } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { promisify } from 'util'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const exec = promisify(execCallback)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 红果短剧标准转场合并
 * anime → fade:duration=0.3（万妖图录风格，快闪）
 * real  → dissolve:duration=0.5（大天蓬风格，柔和叠化）
 */
export async function mergeEpisodesWithTransition(
  clipPaths: string[],
  outputPath: string,
  style: 'anime' | 'real'
): Promise<void> {
  if (clipPaths.length === 0) throw new Error('No clips to merge')
  if (clipPaths.length === 1) {
    // 只有一个镜头，直接复制
    fs.copyFileSync(clipPaths[0], outputPath)
    return
  }

  const transitionDuration = style === 'anime' ? 0.3 : 0.5

  // 构建 filter_complex
  // acrossfade: 音频在重叠区域平滑过渡，视频直接切换
  // 对于视频转场，我们用 acrossfade 的 cuculo 方式只处理音频，
  // 视频用 xfade（但 xfade 需要精确 offset，计算麻烦）
  // 方案：用 acrossfade 处理音频，用 simple concat 处理视频（视觉硬切 + 音频柔过渡）

  // 实际上最可靠的红果短剧方案：
  // 每个分镜之间加入音频淡入淡出，视频本身硬切（快节奏短剧的标准做法）
  // 用 acrossfade 实现音频平滑过渡

  // 构建 FFmpeg 命令
  // 输入文件
  const inputs = clipPaths.map(p => `-i "${p}"`).join(' ')

  // 音频交叉淡入淡出 filter
  // acrossfade=d=0.3:a=1 表示音频交叉淡入淡出 0.3 秒
  let audioFilter = ''
  if (clipPaths.length >= 2) {
    const crossfadeOpts = []
    for (let i = 0; i < clipPaths.length - 1; i++) {
      crossfadeOpts.push(`[${i}:a][${i+1}:a]acrossfade=d=${transitionDuration}:a=1[t${i}]`)
    }
    audioFilter = `-filter_complex "${crossfadeOpts.join(';')};[t0]`
    for (let i = 1; i < clipPaths.length - 1; i++) {
      audioFilter += `[t${i}]`
    }
    audioFilter += `amix=inputs=${clipPaths.length - 1}:duration=first:dropout_transition=2[outa]"`
  }

  // 视频直接 concat（分镜之间视觉硬切，红果短剧标准做法）
  // 音频用 acrossfade 软过渡
  // 所有输入视频强制缩放为 9:16 (1080x1920) 以保证拼接一致性
  let cmd: string
  if (clipPaths.length >= 2) {
    // 9:16 竖屏 scale + concat
    const scaledInputs = clipPaths.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[sv${i}]`)
    const videoFilter = scaledInputs.join(';') + ';' + clipPaths.map((_, i) => `[sv${i}]`).join('') + `concat=n=${clipPaths.length}:v=1:a=0[outv]`
    cmd = `ffmpeg -y ${inputs} -filter_complex "${videoFilter};${audioFilter.replace('[outa]"', '[outa]"')}" -map "[outv]" -map "[outa]" -c:v libx265 -crf 23 -preset fast -c:a aac -b:a 192k -ar 48000 "${outputPath}"`
  } else {
    cmd = `ffmpeg -y -i "${clipPaths[0]}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx265 -crf 23 -preset fast -c:a aac -b:a 192k "${outputPath}"`
  }

  try {
    await exec(cmd)
  } catch (e: any) {
    // 如果上面的命令失败，尝试更简单的方案：直接 concat + 音频淡入淡出
    const simpleCmd = `ffmpeg -y ${inputs} -filter_complex "${clipPaths.map((_, i) => `[${i}:v]pool`).join('')};${clipPaths.map((_, i) => `[${i}:a]afade=t=in:st=0:d=0.2[${i}a];${clipPaths.map((_, i) => `[${i}a]`).join('')}amix=inputs=${clipPaths.length}:duration=first[outa]"`).join('')}${clipPaths.map((_, i) => `[${i}:v]`).join('')}concat=n=${clipPaths.length}:v=1:a=0[outv]" -map "[outv]" -map "[outa]" -c:v libx265 -crf 23 -preset fast -c:a aac -b:a 192k "${outputPath}"`
    try {
      await exec(simpleCmd)
    } catch {
      // 最终保底：简单 concat
      const fallback = `ffmpeg -y ${inputs} -filter_complex "${clipPaths.map((_, i) => `[${i}:v]${clipPaths.map((_, j) => j === i ? `[${i}:v]` : '').join('')}`).join('')}${clipPaths.map((_, i) => `[${i}:v]`).join('')}concat=n=${clipPaths.length}:v=1:a=0[outv];${clipPaths.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${clipPaths.length}:duration=first[outa]" -map "[outv]" -map "[outa]" -c:v libx265 -crf 23 -preset fast -c:a aac -b:a 192k "${outputPath}"`
      await exec(fallback)
    }
  }
}

/**
 * 拼接一集的所有合成镜头视频
 * @param episodeId - Episode ID
 * @param dramaId - Drama ID
 * @param options - Optional: bgmPath, introPath, outroPath
 */
export async function mergeEpisodeVideos(
  episodeId: number,
  dramaId: number,
  options?: { bgmPath?: string | null; introPath?: string | null; outroPath?: string | null; style?: 'anime' | 'real' }
): Promise<number> {
  const storyboards = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
    .all()

  const readyStoryboards = storyboards.filter(sb => !!(sb.composedVideoUrl || sb.videoUrl))
  if (readyStoryboards.length !== storyboards.length) {
    throw new Error(`Only storyboards with composed video or raw video can be merged (${readyStoryboards.length}/${storyboards.length} ready)`)
  }
  const videos = readyStoryboards
    .map(sb => sb.composedVideoUrl || sb.videoUrl)
    .filter(Boolean) as string[]

  if (videos.length === 0) throw new Error('No videos to merge')

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length })

  // 创建 merge 记录
  const ts = now()
  const res = db.insert(schema.videoMerges).values({
    episodeId,
    dramaId,
    title: `Episode ${episodeId} Merge`,
    provider: 'ffmpeg',
    model: 'ffmpeg-concat-h265-aac',
    status: 'processing',
    scenes: JSON.stringify(videos),
    createdAt: ts,
  }).run()
  const mergeId = Number(res.lastInsertRowid)

  // 异步执行
  doMerge(mergeId, episodeId, videos, options).catch(err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId)).run()
  })

  return mergeId
}

async function doMerge(
  mergeId: number,
  episodeId: number,
  videos: string[],
  options?: { bgmPath?: string | null; introPath?: string | null; outroPath?: string | null; style?: 'anime' | 'real' }
) {
  // 构建完整视频列表：intro + content + outro
  const allVideos: string[] = []

  // 片头
  if (options?.introPath) {
    const introAbs = toAbsPath(options.introPath)
    if (fs.existsSync(introAbs)) {
      allVideos.push(introAbs)
    }
  }

  // 正文
  allVideos.push(...videos.map(v => toAbsPath(v)))

  // 片尾
  if (options?.outroPath) {
    const outroAbs = toAbsPath(options.outroPath)
    if (fs.existsSync(outroAbs)) {
      allVideos.push(outroAbs)
    }
  }

  // 输出文件
  const outputDir = path.join(STORAGE_ROOT, 'merged')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  // 使用转场合并
  const style = options?.style || 'anime'
  await mergeEpisodesWithTransition(allVideos, outputPath, style)

  // 如果有 BGM，混合进去
  if (options?.bgmPath) {
    const bgmAbs = toAbsPath(options.bgmPath)
    if (fs.existsSync(bgmAbs)) {
      const bgmOutputPath = outputPath.replace('.mp4', '_bgm.mp4')
      await mixBGM(outputPath, bgmAbs, bgmOutputPath)
      fs.renameSync(bgmOutputPath, outputPath)
    }
  }

  // 清理临时文件
  // （mergeEpisodesWithTransition 不创建临时文件）

  // 获取时长
  const duration = await getVideoDuration(outputPath)

  const mergedRelative = `static/merged/${outputFilename}`

  // 更新 merge 记录
  db.update(schema.videoMerges)
    .set({ status: 'completed', mergedUrl: mergedRelative, duration, completedAt: now() })
    .where(eq(schema.videoMerges.id, mergeId)).run()

  // 更新 episode
  db.update(schema.episodes)
    .set({ videoUrl: mergedRelative, updatedAt: now() })
    .where(eq(schema.episodes.id, episodeId)).run()

  logTaskSuccess('MergeTask', 'episode-merge', { mergeId, episodeId, output: mergedRelative, duration, clips: allVideos.length })
}

/**
 * 混合 BGM 到已有视频
 */
async function mixBGM(videoPath: string, bgmPath: string, outputPath: string): Promise<void> {
  const cmd = `ffmpeg -y -i "${videoPath}" -i "${bgmPath}" -filter_complex "[1:a]volume=0.25,areverse[rev];[1:a][rev]amix=inputs=2:duration=first:dropout_transition=2:weights=0.25 0.25[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2:weights=1 0.3[outa]" -map 0:v -map "[outa]" -c:v copy -c:a aac -b:a 192k -ar 48000 "${outputPath}"`
  await exec(cmd)
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(metadata.format.duration || 0))
    })
  })
}