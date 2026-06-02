/**
 * AnyaIGC 视频生成 Adapter
 * 中转服务，代理火山引擎 Doubao Seedance 系列模型
 * API 格式与 VolcEngine 完全一致（/api/v3/contents/generations/tasks）
 * 仅 baseUrl / provider 不同
 */
import { VolcEngineVideoAdapter } from './volcengine-video.js'
import type { VideoProviderAdapter } from './types.js'

export class AnyaIGCVideoAdapter extends VolcEngineVideoAdapter implements VideoProviderAdapter {
  provider = 'anyaigc'
}
