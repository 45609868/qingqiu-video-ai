import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from './useApi'

export function useAgent() {
  const running = ref(false)
  const runningType = ref<string | null>(null)

  async function run(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void): Promise<void> {
    if (running.value) { toast.warning('操作执行中'); return }
    running.value = true
    runningType.value = type
    try {
      const data = await api.post<any>(`/agent/${type}/chat`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
      })
      toast.success('完成')
      onDone?.()
    } catch (err: any) {
      toast.error(err.message)
      throw err  // re-throw so callers can catch
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  /**
   * 串联执行 pipeline：story_editor → script_rewriter → compliance_reviewer → comparative_reviewer
   * 改写完成后自动触发两阶段审核
   * Returns a Promise that resolves when the pipeline completes (or throws on error)
   */
  async function runPipeline(dramaId: number, episodeId: number, message?: string, onDone?: () => void): Promise<void> {
    if (running.value) { toast.warning('操作执行中'); return }
    running.value = true
    runningType.value = 'pipeline'
    try {
      const data = await api.post<any>(`/agent-pipeline/rewrite-review`, {
        drama_id: dramaId,
        episode_id: episodeId,
        message,
      })
      toast.success('改写+审核完成')
      onDone?.()
    } catch (err: any) {
      toast.error(err.message)
      throw err  // re-throw so callers can catch
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  return { running, runningType, run, runPipeline }
}
