/**
 * FFmpeg 多镜头拼接 — 将所有合成后的镜头视频拼接为一集
 */
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
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
  options?: { bgmPath?: string | null; introPath?: string | null; outroPath?: string | null }
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
    model: 'ffmpeg-concat-h264-aac',
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
  options?: { bgmPath?: string | null; introPath?: string | null; outroPath?: string | null }
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

  // 生成 concat 列表文件
  const listDir = path.join(STORAGE_ROOT, 'temp')
  fs.mkdirSync(listDir, { recursive: true })
  const listPath = path.join(listDir, `${uuid()}.txt`)

  const listContent = allVideos
    .map(v => `file '${v}'`)
    .join('\n')
  fs.writeFileSync(listPath, listContent, 'utf-8')

  // 输出文件
  const outputDir = path.join(STORAGE_ROOT, 'merged')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  await new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])

    // BGM mixing: if bgm provided, loop it to cover full episode duration
    if (options?.bgmPath) {
      const bgmAbs = toAbsPath(options.bgmPath)
      if (fs.existsSync(bgmAbs)) {
        cmd = cmd
          .input(bgmAbs)
          .inputOptions(['-stream_loop', '-1']) // loop BGM to match episode length
      }
    }

    const outputOptions: string[] = [
      '-fflags', '+genpts',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'aac',
      '-ar', '48000',
      '-b:a', '192k',
      '-movflags', '+faststart',
    ]

    if (options?.bgmPath) {
      const bgmAbs = toAbsPath(options.bgmPath)
      if (fs.existsSync(bgmAbs)) {
        // [0:a:0] = concat audio, [1:a:0] = BGM, mix with BGM at 0.25 volume
        outputOptions.push(
          '-filter_complex', '[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=2:weights=1 0.25[outa]',
          '-map', '0:v:0',
          '-map', '[outa]',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
        )
      } else {
        outputOptions.push('-an')
      }
    } else {
      // No BGM: keep original audio
      outputOptions.push('-map', '0:a:0')
    }

    cmd.outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })

  // 清理临时文件
  fs.unlinkSync(listPath)

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

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(metadata.format.duration || 0))
    })
  })
}
