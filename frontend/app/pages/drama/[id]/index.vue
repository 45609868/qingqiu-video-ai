<template>
  <div class="page" v-if="drama">
    <!-- Header -->
    <div class="page-head">
      <div class="head-left">
        <button class="back-btn" @click="navigateTo('/')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          返回
        </button>
        <div class="head-info">
          <h1 class="page-title">{{ drama.title }}</h1>
          <div class="page-meta">
            <span v-if="drama.style" class="style-chip">{{ drama.style }}</span>
            <span v-if="drama.style" class="meta-divider"></span>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {{ drama.characters?.length || 0 }} 角色
            </span>
            <span class="meta-divider"></span>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
              {{ drama.scenes?.length || 0 }} 场景
            </span>
          </div>
        </div>
      </div>
      <button class="btn btn-primary" @click="openAddEpisode">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        添加集
      </button>
      <button class="btn btn-secondary" @click="openOneClick" v-if="!batchStatus || batchStatus.status !== 'running'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        一键生成
      </button>
    </div>

    <!-- Section Label -->
    <div class="section-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="2" y="2" width="20" height="20" rx="2.5"/>
        <line x1="7" y1="8" x2="7" y2="16"/>
        <line x1="10" y1="8" x2="10" y2="16"/>
        <line x1="13" y1="8" x2="13" y2="16"/>
        <line x1="16" y1="8" x2="16" y2="16"/>
      </svg>
      剧集列表
    </div>

    <!-- Batch Progress Bar -->
    <div v-if="batchStatus && batchStatus.status === 'running'" class="batch-progress-card">
      <div class="batch-progress-header">
        <div class="batch-progress-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
          </svg>
          批量生成中
        </div>
        <div class="batch-progress-stats">
          <span class="batch-stat completed">{{ batchStatus.completed }}</span>
          <span class="batch-sep">/</span>
          <span class="batch-stat total">{{ batchStatus.total }}</span>
          <span class="batch-failed" v-if="batchStatus.failed > 0"> · {{ batchStatus.failed }} 失败</span>
        </div>
      </div>
      <div class="batch-progress-bar">
        <div class="batch-progress-fill" :style="{ width: (batchStatus.total ? (batchStatus.completed / batchStatus.total * 100) : 0) + '%' }"></div>
      </div>
      <div class="batch-episodes-grid">
        <div
          v-for="ep in batchStatus.episodes"
          :key="ep.episodeId"
          :class="['batch-ep-chip', `status-${ep.status}`]"
        >
          E{{ episodeNumberById(ep.episodeId) }}
        </div>
      </div>
    </div>

    <div class="ep-grid">
      <div
        v-for="(ep, i) in drama.episodes"
        :key="ep.id"
        class="card ep-card"
        :style="{ animationDelay: `${i * 0.05}s` }"
        @click="goEpisode(ep)"
      >
        <div class="ep-number">E{{ String(ep.episode_number || ep.episodeNumber).padStart(2, '0') }}</div>
        <div class="ep-body">
          <span class="ep-title">{{ ep.title }}</span>
          <div class="ep-status">
            <span :class="['status-dot', epDotClass(ep)]"></span>
            <span class="status-text">{{ epStatusText(ep) }}</span>
            <span v-if="ep.duration" class="ep-duration">{{ ep.duration }}s</span>
          </div>
        </div>
        <button class="ep-delete-btn" @click.stop="deleteEpisode(ep)" title="删除剧集">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
        <div class="ep-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>

      <!-- Empty episode state -->
      <div v-if="!drama.episodes?.length" class="card ep-empty">
        <div class="ep-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <p>点击上方「添加集」创建第一集</p>
      </div>
    </div>

    <div v-if="addDialog" class="dialog-mask" @click.self="addDialog = false">
      <div class="card dialog">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <div class="dialog-kicker">Episode Setup</div>
            <div class="dialog-title-row">
              <div class="dialog-title">创建新集</div>
              <span class="dialog-badge">配置将锁定</span>
            </div>
            <div class="dialog-sub">为这一集预先锁定图片、视频和音频生成服务。创建后，这些生成链路将始终跟随当前集配置。</div>
          </div>
          <button class="back-btn" @click="addDialog = false">取消</button>
        </div>
        <div class="dialog-summary">
          <div class="summary-chip">图片 · {{ imageConfigs.length }} 可选</div>
          <div class="summary-chip">视频 · {{ videoConfigs.length }} 可选</div>
          <div class="summary-chip">音频 · {{ audioConfigs.length }} 可选</div>
        </div>
        <div class="dialog-body">
          <div class="dialog-section">
            <div class="dialog-section-head">
              <span class="dialog-section-title">基础信息</span>
              <span class="dialog-section-copy">这一项只影响显示名称，不影响生成配置</span>
            </div>
            <label class="field">
              <span class="field-label">标题</span>
              <input v-model="newEpisodeTitle" class="input" placeholder="默认按集数自动命名" />
              <span class="field-hint">留空时会自动按集数命名，例如"第 3 集"。</span>
            </label>
          </div>

          <div class="dialog-section">
            <div class="dialog-section-head">
              <span class="dialog-section-title">生成配置</span>
              <span class="dialog-section-copy">创建后不可更改，建议在这里一次性选对</span>
            </div>
            <div class="config-grid">
              <label class="config-card">
                <span class="config-card-kicker">IMAGE</span>
                <span class="field-label">图片配置</span>
                <BaseSelect v-model="newEpisodeImageConfigId" :options="imageConfigOptions" placeholder="选择图片服务" searchable />
              </label>
              <label class="config-card">
                <span class="config-card-kicker">VIDEO</span>
                <span class="field-label">视频配置</span>
                <BaseSelect v-model="newEpisodeVideoConfigId" :options="videoConfigOptions" placeholder="选择视频服务" searchable />
              </label>
              <label class="config-card">
                <span class="config-card-kicker">AUDIO</span>
                <span class="field-label">音频配置</span>
                <BaseSelect v-model="newEpisodeAudioConfigId" :options="audioConfigOptions" placeholder="选择音频服务" searchable />
              </label>
            </div>
          </div>
        </div>
        <div class="dialog-foot">
          <div class="dialog-foot-copy">创建后，工作台中的图片、视频、音频生成入口都会锁定到当前集。</div>
          <button class="btn btn-primary" :disabled="creatingEpisode || !canCreateEpisode" @click="addEpisode">
            {{ creatingEpisode ? '创建中...' : '创建并锁定配置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- One-Click Generate Dialog -->
    <div v-if="oneClickDialog" class="dialog-mask" @click.self="oneClickDialog = false">
      <div class="card dialog">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <div class="dialog-kicker">One-Click Generate</div>
            <div class="dialog-title-row">
              <div class="dialog-title">一键端到端生成</div>
              <span class="dialog-badge dialog-badge-accent">全自动</span>
            </div>
            <div class="dialog-sub">粘贴完整小说内容（用 === 分隔章节），系统自动创建集数、生成剧本、分镜、图片、视频、TTS、合成整集。全程无需手动操作。</div>
          </div>
          <button class="back-btn" @click="oneClickDialog = false">取消</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-section">
            <div class="dialog-section-head">
              <span class="dialog-section-title">小说内容</span>
              <span class="dialog-section-copy">使用 === 分隔章节，例如：<code style="font-size:11px;background:var(--bg-2);padding:1px 4px;border-radius:4px">第一章  xxx\n=== \n第二章  yyy</code></span>
            </div>
            <textarea
              v-model="novelContent"
              class="input"
              style="min-height: 200px; resize: vertical; font-family: inherit"
              placeholder="粘贴小说内容，用 === 分隔每章..."
            ></textarea>
            <div class="field-hint" style="margin-top: 4px">共 {{ chapterCount }} 章 | {{ novelContent.length }} 字</div>
          </div>
          <div class="dialog-section">
            <div class="dialog-section-head">
              <span class="dialog-section-title">BGM 配乐（可选）</span>
              <span class="dialog-section-copy">选择背景音乐，会以 25% 音量混入最终视频</span>
            </div>
            <div class="config-grid" style="grid-template-columns: repeat(3, 1fr)">
              <button
                v-for="bgm in availableBgms"
                :key="bgm.value"
                :class="['config-card', 'bgm-card', selectedBgm === bgm.value ? 'bgm-selected' : '']"
                @click="selectedBgm = selectedBgm === bgm.value ? null : bgm.value"
              >
                <span class="config-card-kicker">BGM</span>
                <span class="field-label">{{ bgm.label }}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="dialog-foot">
          <div class="dialog-foot-copy">将创建 {{ chapterCount }} 集并自动开始视频生成，可关闭页面稍后回来查看进度。</div>
          <button class="btn btn-primary" :disabled="startingOneClick || !canStartOneClick" @click="startOneClick">
            {{ startingOneClick ? '启动中...' : '开始一键生成' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { aiConfigAPI, dramaAPI, episodeAPI } from '~/composables/useApi'

const route = useRoute()
const drama = ref(null)
const dramaId = Number(route.params.id)
const addDialog = ref(false)
const creatingEpisode = ref(false)
const newEpisodeTitle = ref('')
const imageConfigs = ref([])
const videoConfigs = ref([])
const audioConfigs = ref([])
const newEpisodeImageConfigId = ref(null)
const newEpisodeVideoConfigId = ref(null)
const newEpisodeAudioConfigId = ref(null)

// One-click generation
const oneClickDialog = ref(false)
const startingOneClick = ref(false)
const novelContent = ref('')
const selectedBgm = ref(null)
const batchStatus = ref(null)
const batchPollInterval = ref(null)

const availableBgms = [
  { label: '玄幻仙侠', value: 'anime_xuanmei' },
  { label: '古风柔情', value: 'real_gufeng' },
  { label: '燃向战斗', value: 'action_燃' },
  { label: '悬疑惊悚', value: 'thriller' },
  { label: '现代都市', value: 'modern' },
]

const chapterCount = computed(() => {
  const content = novelContent.value
  if (!content) return 0
  return content.split(/===+/).filter(s => s.trim()).length
})

const canStartOneClick = computed(() =>
  !!novelContent.value.trim() && chapterCount.value > 0
)

function episodeNumberById(episodeId) {
  const ep = drama.value?.episodes?.find(e => e.id === episodeId)
  if (!ep) return '??'
  const num = ep.episode_number || ep.episodeNumber
  return String(num).padStart(2, '0')
}

function openOneClick() {
  novelContent.value = ''
  selectedBgm.value = null
  oneClickDialog.value = true
}

async function startOneClick() {
  if (!canStartOneClick.value) return
  try {
    startingOneClick.value = true
    const res = await fetch(`/api/v1/dramas/${dramaId}/one-click-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_content: novelContent.value,
        bgm_path: selectedBgm.value ? `static/bgm/${selectedBgm.value}.mp3` : null,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || '启动失败')
    toast.success('已开始一键生成')
    oneClickDialog.value = false
    startBatchPoll(data.data?.task_id || data.data?.batch?.id)
  } catch (e) {
    toast.error(e.message)
  } finally {
    startingOneClick.value = false
  }
}

async function pollBatchStatus(taskId) {
  if (!taskId) return
  try {
    const res = await fetch(`/api/v1/dramas/${dramaId}/batch-generate/${taskId}`)
    const data = await res.json()
    if (data.data) {
      batchStatus.value = {
        status: data.data.status,
        total: data.data.total,
        completed: data.data.completed,
        failed: data.data.failed,
        episodes: data.data.episodes,
      }
      if (data.data.status === 'completed' || data.data.status === 'failed') {
        stopBatchPoll()
        if (data.data.status === 'completed') {
          toast.success(`批量生成完成：${data.data.completed} 集成功`)
          load()
        } else {
          toast.error(`批量生成结束：${data.data.failed} 集失败`)
        }
      }
    }
  } catch (e) {
    console.error('Poll error:', e)
  }
}

function startBatchPoll(taskId) {
  stopBatchPoll()
  pollBatchStatus(taskId)
  batchPollInterval.value = setInterval(() => pollBatchStatus(taskId), 8000)
}

function stopBatchPoll() {
  if (batchPollInterval.value) {
    clearInterval(batchPollInterval.value)
    batchPollInterval.value = null
  }
}

onMounted(() => {
  load()
  loadConfigs()
  // Poll batch status if any episode is running
  checkRunningBatch()
})

onUnmounted(() => {
  stopBatchPoll()
})

async function checkRunningBatch() {
  // Check if there's an active batch task for this drama
  try {
    const res = await fetch(`/api/v1/dramas/${dramaId}/one-click-generate`)
    const data = await res.json()
    if (data.data?.batch?.status === 'running') {
      batchStatus.value = data.data.batch
      startBatchPoll(data.data.task_id)
    }
  } catch (e) {}
}

function hasScript(ep) { return !!(ep.script_content || ep.scriptContent) }

function epDotClass(ep) {
  if (ep.video_url || ep.videoUrl) return 'dot-ready'
  if (ep.generation_status === 'running') return 'dot-running'
  if (ep.generation_status === 'failed') return 'dot-error'
  if (hasScript(ep)) return 'dot-script'
  return 'dot-pending'
}

function epStatusText(ep) {
  if (ep.video_url || ep.videoUrl) return '已完成'
  if (ep.generation_status === 'running') return '生成中'
  if (ep.generation_status === 'failed') return '生成失败'
  if (hasScript(ep)) return '待生成'
  return '待编写'
}

function episodePath(ep) {
  const number = ep.episode_number || ep.episodeNumber
  return `/drama/${dramaId}/episode/${number}`
}

function goEpisode(ep) {
  const target = episodePath(ep)
  window.location.href = target
}

async function deleteEpisode(ep) {
  const num = ep.episode_number || ep.episodeNumber
  if (!window.confirm(`确定删除第 ${num} 集吗？删除后无法恢复。`)) return
  try {
    await episodeAPI.del(ep.id)
    drama.value.episodes = drama.value.episodes.filter(e => e.id !== ep.id)
    toast.success('已删除')
  } catch (e) {
    toast.error(e.message)
  }
}

function configLabel(config) {
  if (!config) return ''
  let modelName = ''
  try { const m = JSON.parse(config.model || '[]'); modelName = Array.isArray(m) ? (m[0] || '') : (m || '') } catch { modelName = config.model || '' }
  return modelName ? `${config.name} · ${modelName} (${config.provider})` : `${config.name} (${config.provider})`
}

const imageConfigOptions = computed(() => imageConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const videoConfigOptions = computed(() => videoConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const audioConfigOptions = computed(() => audioConfigs.value.map(c => ({ label: configLabel(c), value: c.id })))
const canCreateEpisode = computed(() => !!(newEpisodeImageConfigId.value && newEpisodeVideoConfigId.value && newEpisodeAudioConfigId.value))

async function load() {
  try {
    drama.value = await dramaAPI.get(dramaId)
  } catch (e) {
    toast.error(e.message)
  }
}

async function loadConfigs() {
  try {
    const [imgs, vids, auds] = await Promise.all([
      aiConfigAPI.list('image'),
      aiConfigAPI.list('video'),
      aiConfigAPI.list('audio'),
    ])
    imageConfigs.value = imgs || []
    videoConfigs.value = vids || []
    audioConfigs.value = auds || []
    if (!newEpisodeImageConfigId.value && imageConfigs.value.length) newEpisodeImageConfigId.value = imageConfigs.value[0].id
    if (!newEpisodeVideoConfigId.value && videoConfigs.value.length) newEpisodeVideoConfigId.value = videoConfigs.value[0].id
    if (!newEpisodeAudioConfigId.value && audioConfigs.value.length) newEpisodeAudioConfigId.value = audioConfigs.value[0].id
  } catch (e) {
    toast.error(e.message)
  }
}

function openAddEpisode() {
  newEpisodeTitle.value = ''
  addDialog.value = true
}

async function addEpisode() {
  try {
    creatingEpisode.value = true
    await episodeAPI.create({
      drama_id: dramaId,
      title: newEpisodeTitle.value || undefined,
      image_config_id: newEpisodeImageConfigId.value,
      video_config_id: newEpisodeVideoConfigId.value,
      audio_config_id: newEpisodeAudioConfigId.value,
    })
    toast.success('已添加新集')
    addDialog.value = false
    load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    creatingEpisode.value = false
  }
}

onMounted(() => { load(); loadConfigs() })
</script>

<style scoped>
.page {
  padding: 28px 48px 40px;
  overflow-y: auto;
  height: 100%;
  animation: fadeUp 0.35s var(--ease-out) both;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 24px;
  gap: 20px;
}
.head-left { display: flex; align-items: flex-start; gap: 12px; }
.head-info { display: flex; flex-direction: column; gap: 8px; }

.back-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-0); color: var(--text-2);
  cursor: pointer; transition: all 0.18s var(--ease-out);
  box-shadow: var(--shadow-xs);
}
.back-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); color: var(--text-0); }

.page-title {
  font-family: var(--font-display);
  font-size: 26px; font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.page-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.style-chip {
  font-size: 11px; font-weight: 500;
  padding: 2px 8px;
  background: var(--accent-bg); color: var(--accent-text);
  border-radius: 99px; border: 1px solid rgba(184,120,20,0.12);
}
.meta-divider { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); }
.meta-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--text-2);
}

/* Section label */
.section-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 700;
  color: var(--text-3); letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

/* Episode Grid */
.ep-grid { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }

.ep-card {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 16px;
  cursor: pointer;
  color: inherit;
  text-decoration: none;
  animation: fadeUp 0.35s var(--ease-out) both;
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s;
}
.ep-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
  transform: translateX(4px);
}

.ep-number {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: var(--radius);
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  font-size: 12px; font-weight: 700;
  color: var(--text-2);
  transition: all 0.18s;
}
.ep-card:hover .ep-number {
  background: var(--accent-bg);
  border-color: rgba(184,120,20,0.2);
  color: var(--accent);
}

.ep-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.ep-title { font-size: 14px; font-weight: 600; color: var(--text-0); }
.ep-status { display: flex; align-items: center; gap: 6px; }
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dot-ready { background: var(--success); }
.dot-pending { background: var(--text-3); }
.dot-running { background: var(--accent); animation: pulse 1.5s infinite; }
.dot-error { background: var(--error); }
.dot-script { background: #f59e0b; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.status-text { font-size: 11px; color: var(--text-3); }
.ep-duration { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); margin-left: 4px; }

.ep-arrow { color: var(--text-3); flex-shrink: 0; transition: transform 0.18s; }

.ep-delete-btn {
  display: none;
  padding: 6px;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  border-radius: var(--radius);
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
  margin-left: 4px;
}
.ep-delete-btn:hover { color: var(--error); background: rgba(239,68,68,0.1); }
.ep-card:hover .ep-delete-btn { display: flex; align-items: center; }
.ep-card:hover .ep-arrow { transform: translateX(3px); color: var(--accent); }

/* Empty */
.ep-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px; text-align: center; color: var(--text-3); font-size: 13px;
  border-style: dashed;
}
.ep-empty-icon {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--bg-2); display: flex; align-items: center; justify-content: center;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 38, 0.18);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dialog {
  width: min(760px, 100%);
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 26px 26px 22px;
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, rgba(122,167,255,0.14), transparent 34%),
    radial-gradient(circle at top right, rgba(76,125,255,0.08), transparent 26%),
    linear-gradient(180deg, rgba(255,255,255,0.98), rgba(242,247,255,0.92));
  overflow: hidden;
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: 0 22px 52px rgba(32, 48, 77, 0.14), 0 8px 18px rgba(32, 48, 77, 0.08);
}
.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dialog-head-copy { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
.dialog-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
}
.dialog-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dialog-title { font-size: 28px; font-weight: 800; color: var(--text-0); letter-spacing: -0.03em; }
.dialog-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(76,125,255,0.1);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 700;
}
.dialog-sub { font-size: 14px; line-height: 1.7; color: var(--text-2); }
.dialog-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(27, 41, 64, 0.08);
  font-size: 12px;
  color: var(--text-2);
}
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 4px;
}
.dialog-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 22px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.dialog-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.dialog-section-title { font-size: 14px; font-weight: 700; color: var(--text-0); }
.dialog-section-copy { font-size: 12px; color: var(--text-3); }
.config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.config-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(244,248,255,0.96), rgba(255,255,255,0.78));
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.config-card-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-3);
}
.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 2px;
}
.dialog-foot-copy {
  flex: 1;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}

/* Batch Progress */
.batch-progress-card {
  max-width: 760px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(76,125,255,0.08), rgba(122,167,255,0.06));
  border: 1px solid rgba(76,125,255,0.15);
}
.batch-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.batch-progress-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-text);
}
.batch-progress-stats {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
}
.batch-stat.completed { font-weight: 700; color: var(--success); font-family: var(--font-mono); }
.batch-stat.total { color: var(--text-2); font-family: var(--font-mono); }
.batch-sep { color: var(--text-3); margin: 0 2px; }
.batch-failed { color: var(--error); font-size: 12px; }
.batch-progress-bar {
  height: 6px;
  border-radius: 99px;
  background: rgba(76,125,255,0.12);
  overflow: hidden;
  margin-bottom: 10px;
}
.batch-progress-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent), #5a9fff);
  transition: width 0.4s ease;
}
.batch-episodes-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.batch-ep-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.batch-ep-chip.status-pending { background: rgba(255,255,255,0.4); color: var(--text-2); }
.batch-ep-chip.status-running { background: rgba(76,125,255,0.2); color: var(--accent-text); }
.batch-ep-chip.status-completed { background: rgba(34,197,94,0.15); color: var(--success); }
.batch-ep-chip.status-failed { background: rgba(239,68,68,0.15); color: var(--error); }

/* BGM card */
.bgm-card { cursor: pointer; text-align: left; }
.bgm-card.bgm-selected {
  border-color: var(--accent);
  background: linear-gradient(180deg, rgba(76,125,255,0.12), rgba(76,125,255,0.06));
}
.dialog-badge-accent {
  background: rgba(34,197,94,0.12);
  color: var(--success);
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 12px; color: var(--text-3); }

@media (max-width: 860px) {
  .dialog {
    width: 100%;
    max-height: calc(100vh - 24px);
    padding: 18px;
    border-radius: 22px;
  }

  .dialog-title {
    font-size: 24px;
  }

  .config-grid {
    grid-template-columns: 1fr;
  }

  .dialog-foot {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
