/**
 * OpenAI / GPT Image 图片生成 Adapter
 * - 无参考图: /v1/images/generations
 * - 有参考图且模型为 GPT Image: /v1/images/edits
 * 响应格式: { data: [{ url: "..." }] } 或 { data: [{ b64_json: "..." }] }
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { parseDataUrl } from '../../utils/storage.js'

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'gpt-image-1'
    const size = this.normalizeSize(record.size)
    const refs = this.parseReferenceImages(record.referenceImages)
    const isGptImage = this.isGptImageModel(model)

    const body: any = {
      model,
      prompt: record.prompt,
      size,
      n: 1,
    }

    // GPT Image 默认返回 b64_json；DALL-E 仍使用 url，方便直接下载。
    if (!isGptImage) {
      body.response_format = 'url'
    }

    let hasMultipartReferences = false
    if (isGptImage && refs.length) {
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', record.prompt || 'Generate an image')
      form.append('size', size)
      form.append('n', '1')
      refs.forEach((ref: string, index: number) => {
        const file = this.dataUrlToFile(ref, `reference-${index + 1}.jpg`)
        if (file) {
          hasMultipartReferences = true
          form.append('image[]', file, `reference-${index + 1}.jpg`)
        }
      })
      if (hasMultipartReferences) body.__multipart = form
    }

    const endpoint = isGptImage && hasMultipartReferences ? '/images/edits' : '/images/generations'
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.apiKey}`,
    }
    if (!body.__multipart) headers['Content-Type'] = 'application/json'

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', endpoint),
      method: 'POST',
      headers,
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    // b64_json 模式
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      // 对于 base64，返回特殊标记，实际处理在 extractImageBase64
      return { isAsync: false, imageUrl: undefined }
    }
    // 部分代理可能异步返回 task_id/id；必须放在 data 解析之后，否则 GPT Image 同步响应里的 id 会被误判成轮询任务。
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/task/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.status === 'completed') {
      return {
        status: 'completed',
        imageUrl: result.image_url || result.data?.[0]?.url || null,
      }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error?.message || 'Generation failed' }
    }
    return { status: result.status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { data: b64, mimeType: 'image/png' }
    }
    return null
  }

  private isGptImageModel(model: string) {
    const value = String(model || '').toLowerCase()
    return value.includes('gpt-image') || value.includes('chatgpt-image')
  }

  private parseReferenceImages(raw: string | null | undefined) {
    if (!raw) return []
    try {
      return JSON.parse(raw)
        .map((ref: any) => String(ref || '').trim())
        .filter(Boolean)
        .slice(0, 10)
    } catch {
      return []
    }
  }

  private normalizeSize(raw?: string | null) {
    const validSizes = ['1024x1024', '1024x1536', '1536x1024', 'auto']
    if (!raw) return '1024x1024'
    if (validSizes.includes(raw)) return raw

    const [w, h] = String(raw).split('x').map(v => Number(v))
    if (!w || !h) return '1024x1024'
    const ratio = w / h
    if (ratio > 1.15) return '1536x1024'
    if (ratio < 0.87) return '1024x1536'
    return '1024x1024'
  }

  private dataUrlToFile(dataUrl: string, filename: string): Blob | null {
    const parsed = parseDataUrl(dataUrl)
    if (!parsed) return null
    const buffer = Buffer.from(parsed.data, 'base64')
    return new Blob([buffer], { type: parsed.mimeType || 'image/jpeg' })
  }
}
