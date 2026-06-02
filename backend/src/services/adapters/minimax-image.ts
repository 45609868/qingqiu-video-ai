/**
 * MiniMax 图片生成 Adapter
 * API 风格与 OpenAI 兼容，零改动
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types.js'
import { joinProviderUrl } from './url.js'

export class MiniMaxImageAdapter implements ImageProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const size = record.size || '1920x1080'
    const body: any = {
      model: record.model || config.model,
      prompt: record.prompt,
      size,
      n: 1,
    }

    // MiniMax 支持 reference_images（参考图）
    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
        if (refs.length > 0) {
          body.image = refs // 支持多张参考图
        }
      } catch {}
    }

    // MiniMax only accepts fixed aspect-ratio labels, not raw dimensions.
    body.aspect_ratio = this.normalizeAspectRatio(size)

    // Ensure 9:16 vertical format
    body.aspect_ratio = '9:16'

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/image_generation'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const statusCode = result.base_resp?.status_code
    if (statusCode && statusCode !== 0) {
      throw new Error(result.base_resp?.status_msg || `MiniMax image generation failed: ${statusCode}`)
    }
    if (result.error) {
      throw new Error(result.error.message || result.error_msg || 'MiniMax image generation failed')
    }
    const imageUrl = this.extractImageUrl(result)
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    // 异步模式：返回 task_id
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    throw new Error('No image URL or task_id in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/image_generation/task/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const statusCode = result.base_resp?.status_code
    if (statusCode && statusCode !== 0) {
      return { status: 'failed', error: result.base_resp?.status_msg || `MiniMax image generation failed: ${statusCode}` }
    }

    const status = result.status || result.state
    const imageUrl = this.extractImageUrl(result)
    if (imageUrl) {
      return { status: 'completed', imageUrl }
    }
    if (status === 'completed' || status === 'succeeded') {
      return { status: 'failed', error: 'MiniMax task completed without image URL' }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: result.error_msg || result.error || 'Generation failed' }
    }
    return { status: status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.image_url
      || result.data?.image_url
      || result.data?.image_urls?.[0]
      || result.data?.[0]?.url
      || result.url
      || result.data?.url
      || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    // MiniMax 通常返回 URL，不返回 base64
    return null
  }

  private normalizeAspectRatio(size: string): string {
    const [rawW, rawH] = size.split('x').map(Number)
    if (!rawW || !rawH) return '16:9'

    const ratio = rawW / rawH
    const supported = [
      { value: '1:1', ratio: 1 },
      { value: '16:9', ratio: 16 / 9 },
      { value: '4:3', ratio: 4 / 3 },
      { value: '3:2', ratio: 3 / 2 },
      { value: '2:3', ratio: 2 / 3 },
      { value: '3:4', ratio: 3 / 4 },
      { value: '9:16', ratio: 9 / 16 },
      { value: '21:9', ratio: 21 / 9 },
    ]

    return supported.reduce((best, item) => (
      Math.abs(item.ratio - ratio) < Math.abs(best.ratio - ratio) ? item : best
    )).value
  }
}
