/**
 * Agent Pipeline 路由 — 串联多个 Agent 执行
 * POST /agent-pipeline/rewrite-review
 * 流程：story_editor → script_rewriter → compliance_reviewer → comparative_reviewer
 */
import { Hono } from 'hono'
import { createAgent } from '../agents/index.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

const app = new Hono()

// POST /agent-pipeline/rewrite-review
// Body: { drama_id, episode_id, message? }
app.post('/rewrite-review', async (c) => {
  const body = await c.req.json()
  const { drama_id, episode_id, message } = body

  if (!episode_id || !drama_id) {
    return badRequest(c, 'drama_id and episode_id are required')
  }

  const results: any[] = []
  const errors: any[] = []

  // Step 1: story_editor（总编判断）
  try {
    logTaskStart('Pipeline', 'step1:story_editor', { drama_id, episode_id })
    const editor = createAgent('story_editor', episode_id, drama_id)
    if (!editor) throw new Error('story_editor agent not found')

    const editorResult = await editor.generate(
      [{
        role: 'user',
        content: message || '请作为短剧总编，分析当前集的核心卖点、取舍策略、推荐结构，并输出给 script_rewriter 的执行指令。',
      }],
      { maxSteps: 10 }
    )

    logTaskSuccess('Pipeline', 'step1:story_editor', { textLength: editorResult.text?.length || 0 })
    results.push({
      step: 'story_editor',
      status: 'done',
      text: editorResult.text || '',
    })
  } catch (err: any) {
    logTaskError('Pipeline', 'step1:story_editor', { error: err.message })
    errors.push({ step: 'story_editor', error: err.message })
  }

  // Step 2: script_rewriter（剧本改写）
  try {
    logTaskStart('Pipeline', 'step2:script_rewriter', { drama_id, episode_id })
    const rewriter = createAgent('script_rewriter', episode_id, drama_id)
    if (!rewriter) throw new Error('script_rewriter agent not found')

    const editorResultText = results[0]?.text || ''
    const rewriterMessage = [
      message || '请读取原始小说内容，改写成一集短剧剧本。',
      '',
      '【执行指令 / 不要复述下面这段】',
      '<上游策略>',
      editorResultText,
      '</上游策略>',
      '',
      '【你现在要做的】',
      '直接输出格式化剧本。\n',
      '1. 第一行必须是 \`# 第X集《...》\`\n',
      '2. 不要再确认、不要分析、不要说"好的/接下来"\n',
      '3. 输出里看不到任何 <上游策略> 里的原话\n',
      '4. 1500-3000 字符，含 ≥8 个 ## S 场景头、≥30 条对白',
    ].join('\n')

    const rewriterResult = await rewriter.generate(
      [{ role: 'user', content: rewriterMessage }],
      { maxSteps: 20 }
    )

    const scriptText = rewriterResult.text || ''
    logTaskSuccess('Pipeline', 'step2:script_rewriter', { textLength: scriptText.length })
    results.push({
      step: 'script_rewriter',
      status: 'done',
      text: scriptText,
    })

    // pipeline 直接保存剧本，不依赖 AI 调用 save_script
    if (scriptText) {
      try {
        db.update(schema.episodes)
          .set({ scriptContent: scriptText, updatedAt: new Date().toISOString() })
          .where(eq(schema.episodes.id, episode_id))
          .run()
        logTaskSuccess('Pipeline', 'script_content_saved', { episode_id, length: scriptText.length })
      } catch (e: any) {
        logTaskError('Pipeline', 'script_content_save', { error: e.message })
      }
    }
  } catch (err: any) {
    logTaskError('Pipeline', 'step2:script_rewriter', { error: err.message })
    errors.push({ step: 'script_rewriter', error: err.message })
  }

  // 如果 script_rewriter 失败，不继续审核
  if (!results.find(r => r.step === 'script_rewriter')) {
    return success(c, {
      status: 'failed',
      message: 'script_rewriter failed, review skipped',
      results,
      errors,
    })
  }

  // Step 3: compliance_reviewer + comparative_reviewer — 并行执行
  // 两个 reviewer 独立读取同一份剧本，并行审核节省时间
  const reviewerPromises: Promise<{ step: string; text: string }>[] = []

  // Step 3a: compliance_reviewer
  reviewerPromises.push(
    (async () => {
      try {
        logTaskStart('Pipeline', 'step3:compliance_reviewer', { drama_id, episode_id })
        const compliance = createAgent('compliance_reviewer', episode_id, drama_id)
        if (!compliance) throw new Error('compliance_reviewer agent not found')

        const complianceResult = await compliance.generate(
          [{ role: 'user', content: '请对已改写的剧本进行合规审核。' }],
          { maxSteps: 10 }
        )

        logTaskSuccess('Pipeline', 'step3:compliance_reviewer', { textLength: complianceResult.text?.length || 0 })
        return {
          step: 'compliance_reviewer',
          text: complianceResult.text || '',
        }
      } catch (err: any) {
        logTaskError('Pipeline', 'step3:compliance_reviewer', { error: err.message })
        errors.push({ step: 'compliance_reviewer', error: err.message })
        return { step: 'compliance_reviewer', text: '' }
      }
    })()
  )

  // Step 3b: comparative_reviewer — 并行执行，不等 compliance 完成
  reviewerPromises.push(
    (async () => {
      try {
        logTaskStart('Pipeline', 'step4:comparative_reviewer', { drama_id, episode_id })
        const comparative = createAgent('comparative_reviewer', episode_id, drama_id)
        if (!comparative) throw new Error('comparative_reviewer agent not found')

        const comparativeResult = await comparative.generate(
          [{ role: 'user', content: '请对已改写的剧本进行质量审核，对比爆款标准给出评分和改进建议。' }],
          { maxSteps: 10 }
        )

        logTaskSuccess('Pipeline', 'step4:comparative_reviewer', { textLength: comparativeResult.text?.length || 0 })
        return {
          step: 'comparative_reviewer',
          text: comparativeResult.text || '',
        }
      } catch (err: any) {
        logTaskError('Pipeline', 'step4:comparative_reviewer', { error: err.message })
        errors.push({ step: 'comparative_reviewer', error: err.message })
        return { step: 'comparative_reviewer', text: '' }
      }
    })()
  )

  // 等待两个 reviewer 并行完成
  const reviewerResults = await Promise.all(reviewerPromises)
  for (const r of reviewerResults) {
    results.push({ step: r.step, status: 'done', text: r.text })
  }

  return success(c, {
    status: 'done',
    results,
    errors: errors.length ? errors : null,
  })
})

export default app