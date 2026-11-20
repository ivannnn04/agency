import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import {
  PROJECT_FACTORS, ProjectFactorKey, ProjectFactorScore, ProjectMetrics, healthFrom,
} from '@/lib/projectFactors'

// How a project is going: hard numbers computed from the board, time
// tracking and money, plus an AI review that reads those numbers together
// with the calls and the client chat and says what to do about them.

const MODEL = process.env.PROJECT_AI_MODEL || process.env.LEAD_AI_MODEL || 'claude-opus-5'
export const REVIEW_VERSION = 1

export interface ProjectReview {
  health: number
  status: 'on_track' | 'at_risk' | 'off_track'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  deadline_outlook: string
  factors: ProjectFactorScore[]
  speed_up: { where: string; action: string; why: string }[]
  advice: string[]
  reminders: { text: string; when: string }[]
  risks: string[]
  version: number
}

interface TaskRow {
  id: string
  title: string
  column_id: string | null
  start_date: string | null
  due_date: string | null
  estimate_hours: number | null
  priority: string | null
  created_at: string
}

export interface ProjectData {
  project: Record<string, unknown> & { id: string; name: string }
  columns: { id: string; name: string; position: number }[]
  tasks: TaskRow[]
  assignees: Map<string, string[]>
  trackedByTask: Map<string, number>
  tracked14d: number
  phases: { title: string; start_date: string | null; end_date: string | null; done: boolean }[]
  received: Record<string, number>
  messages: { channel: string; sender_type: string; sender_name: string | null; content: string | null; created_at: string }[]
  changeRequests: { content: string | null; status: string; created_at: string }[]
  meetings: { id: string; title: string; started_at: string | null; recap: string | null; transcript: string | null; attendees: string[] }[]
}

const DAY = 86_400_000
const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
const dayNum = (iso: string) => Math.floor(new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime() / DAY)
const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10)
const round1 = (n: number) => Math.round(n * 10) / 10

// A query whose table or column is not migrated yet yields an empty list
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q
  return error || !Array.isArray(data) ? [] : (data as T[])
}

export async function loadProjectData(projectId: string): Promise<ProjectData | null> {
  const { data: project } = await supabaseAdmin.from('projects').select('*').eq('id', projectId).maybeSingle()
  if (!project) return null

  const [columns, tasks, phases, income, messages, changeRequests, meetings] = await Promise.all([
    rows<ProjectData['columns'][number]>(supabaseAdmin.from('pm_columns').select('id, name, position').eq('project_id', projectId).order('position')),
    rows<TaskRow>(supabaseAdmin.from('pm_tasks').select('id, title, column_id, start_date, due_date, estimate_hours, priority, created_at').eq('finance_project_id', projectId).order('created_at')),
    rows<ProjectData['phases'][number]>(supabaseAdmin.from('project_milestones').select('title, start_date, end_date, done').eq('project_id', projectId).order('position')),
    rows<{ amount: number; currency: string }>(supabaseAdmin.from('transactions').select('amount, currency').eq('project_id', projectId).eq('type', 'income').eq('is_planned', false)),
    rows<ProjectData['messages'][number]>(supabaseAdmin.from('project_messages').select('channel, sender_type, sender_name, content, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(80)),
    rows<ProjectData['changeRequests'][number]>(supabaseAdmin.from('change_requests').select('content, status, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30)),
    rows<ProjectData['meetings'][number]>(supabaseAdmin.from('lead_meetings').select('id, title, started_at, recap, transcript, attendees').eq('project_id', projectId).eq('ignored', false).order('started_at', { ascending: true })),
  ])

  const taskIds = tasks.map(t => t.id)
  const [links, members, entries] = taskIds.length === 0 ? [[], [], []] : await Promise.all([
    rows<{ task_id: string; team_member_id: string }>(supabaseAdmin.from('task_assignees').select('task_id, team_member_id').in('task_id', taskIds)),
    rows<{ id: string; name: string }>(supabaseAdmin.from('team_members').select('id, name')),
    rows<{ task_id: string; started_at: string; duration_seconds: number | null }>(supabaseAdmin.from('time_entries').select('task_id, started_at, duration_seconds').in('task_id', taskIds).not('ended_at', 'is', null)),
  ])

  const nameOf = new Map(members.map(m => [m.id, m.name]))
  const assignees = new Map<string, string[]>()
  for (const l of links) {
    const n = nameOf.get(l.team_member_id)
    if (n) assignees.set(l.task_id, [...(assignees.get(l.task_id) ?? []), n])
  }
  const trackedByTask = new Map<string, number>()
  let tracked14d = 0
  const since = Date.now() - 14 * DAY
  for (const e of entries) {
    const h = (e.duration_seconds ?? 0) / 3600
    trackedByTask.set(e.task_id, (trackedByTask.get(e.task_id) ?? 0) + h)
    if (new Date(e.started_at).getTime() >= since) tracked14d += h
  }
  const received: Record<string, number> = {}
  for (const t of income) received[t.currency] = (received[t.currency] ?? 0) + Number(t.amount)

  return {
    project: project as ProjectData['project'],
    columns, tasks, assignees, trackedByTask, tracked14d, phases, received,
    messages: [...messages].reverse(),
    changeRequests, meetings,
  }
}

export function computeMetrics(d: ProjectData): ProjectMetrics {
  const today = kyivToday()
  const p = d.project
  const start = (p.start_date as string | null) ?? null
  const deadline = (p.deadline as string | null) ?? null

  // The last board column is where finished work lands
  const lastCol = d.columns.length > 0 ? d.columns[d.columns.length - 1] : null
  const colName = new Map(d.columns.map(c => [c.id, c.name]))
  const isDone = (t: TaskRow) => !!lastCol && t.column_id === lastCol.id
  const open = d.tasks.filter(t => !isDone(t))
  const who = (t: TaskRow) => (d.assignees.get(t.id) ?? []).join(', ') || 'без виконавця'

  const est = (t: TaskRow) => Number(t.estimate_hours ?? 0)
  const tracked = (t: TaskRow) => d.trackedByTask.get(t.id) ?? 0
  const estimateTotal = d.tasks.reduce((s, t) => s + est(t), 0)
  const estimateDone = d.tasks.filter(isDone).reduce((s, t) => s + est(t), 0)

  // Hours still to do: what is left of each open estimate; a task with no
  // estimate is assumed to be as large as the average estimated task
  const estimated = d.tasks.filter(t => est(t) > 0)
  const avgEst = estimated.length > 0 ? estimated.reduce((s, t) => s + est(t), 0) / estimated.length : 0
  const remaining = open.reduce((s, t) => s + (est(t) > 0 ? Math.max(est(t) - tracked(t), 0) : avgEst), 0)

  const perDay = d.tracked14d / 14
  let forecast: string | null = null
  let note = ''
  if (open.length === 0) { forecast = today; note = 'Усі задачі закриті' }
  else if (remaining === 0) note = 'В задач немає оцінок у годинах — прогноз порахувати нема з чого'
  else if (perDay <= 0) note = 'За останні 14 днів час не трекався — за поточного темпу робота не рухається'
  else {
    forecast = addDays(today, Math.ceil(remaining / perDay))
    note = `Лишилось ~${Math.round(remaining)} год роботи; темп за 14 днів — ${round1(perDay * 7)} год на тиждень`
  }

  const openDue = open.map(t => t.due_date).filter(Boolean) as string[]
  const phaseEnds = d.phases.filter(ph => !ph.done).map(ph => ph.end_date).filter(Boolean) as string[]
  const planned = [...openDue, ...phaseEnds].sort().pop() ?? null

  const clientMsgs = d.messages.filter(m => m.channel === 'client')
  const lastClient = clientMsgs[clientMsgs.length - 1]
  const waiting = lastClient && lastClient.sender_type === 'client'
    ? Math.floor((Date.now() - new Date(lastClient.created_at).getTime()) / DAY)
    : null

  const byColumn = d.columns.map(c => ({ name: c.name, count: d.tasks.filter(t => t.column_id === c.id).length }))
  const countIn = (re: RegExp) => open.filter(t => re.test(colName.get(t.column_id ?? '') ?? '')).length

  return {
    today,
    start_date: start,
    deadline,
    days_total: start && deadline ? dayNum(deadline) - dayNum(start) : null,
    days_left: deadline ? dayNum(deadline) - dayNum(today) : null,
    time_elapsed_pct: start && deadline && dayNum(deadline) > dayNum(start)
      ? Math.max(0, Math.min(100, Math.round(((dayNum(today) - dayNum(start)) / (dayNum(deadline) - dayNum(start))) * 100)))
      : null,
    tasks_total: d.tasks.length,
    tasks_done: d.tasks.length - open.length,
    progress_pct: d.tasks.length > 0 ? Math.round(((d.tasks.length - open.length) / d.tasks.length) * 100) : 0,
    progress_hours_pct: estimateTotal > 0 ? Math.round((estimateDone / estimateTotal) * 100) : null,
    by_column: byColumn,
    overdue: open
      .filter(t => t.due_date && t.due_date.slice(0, 10) < today)
      .map(t => ({ title: t.title, due_date: t.due_date!.slice(0, 10), days_late: dayNum(today) - dayNum(t.due_date!), who: who(t) }))
      .sort((a, b) => b.days_late - a.days_late),
    due_soon: open
      .filter(t => t.due_date && t.due_date.slice(0, 10) >= today && t.due_date.slice(0, 10) <= addDays(today, 7))
      .map(t => ({ title: t.title, due_date: t.due_date!.slice(0, 10), who: who(t) }))
      .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    blocked: countIn(/block/i),
    waiting_feedback: countIn(/feedback|waiting/i),
    open_without_dates: open.filter(t => !t.start_date || !t.due_date).length,
    open_without_estimate: open.filter(t => est(t) <= 0).length,
    open_without_assignee: open.filter(t => (d.assignees.get(t.id) ?? []).length === 0).length,
    estimate_hours_total: round1(estimateTotal),
    estimate_hours_remaining: round1(remaining),
    tracked_hours_total: round1(d.tasks.reduce((s, t) => s + tracked(t), 0)),
    tracked_hours_14d: round1(d.tracked14d),
    overruns: d.tasks
      .filter(t => est(t) > 0 && tracked(t) > est(t) * 1.15)
      .map(t => ({ title: t.title, estimate: round1(est(t)), tracked: round1(tracked(t)) }))
      .sort((a, b) => (b.tracked - b.estimate) - (a.tracked - a.estimate)),
    forecast_finish: forecast,
    forecast_days_late: forecast && deadline ? dayNum(forecast) - dayNum(deadline) : null,
    forecast_note: note,
    planned_finish: planned,
    phases: d.phases.map(ph => ({ ...ph, late: !ph.done && !!ph.end_date && ph.end_date < today })),
    contract: p.contract_amount ? { amount: Number(p.contract_amount), currency: String(p.contract_currency ?? 'USD') } : null,
    received: d.received,
    open_change_requests: d.changeRequests.filter(c => c.status !== 'done').length,
    client_waiting_reply_days: waiting,
    calls: d.meetings.length,
    last_call_at: d.meetings.length > 0 ? d.meetings[d.meetings.length - 1].started_at : null,
  }
}

function buildContext(d: ProjectData, m: ProjectMetrics): string {
  const colName = new Map(d.columns.map(c => [c.id, c.name]))
  const parts: string[] = [`# Проєкт: ${d.project.name}`]
  if (typeof d.project.notes === 'string' && d.project.notes.trim()) parts.push(`## Нотатки проєкту\n${d.project.notes.trim().slice(0, 6000)}`)

  parts.push(`## Метрики (пораховані з борди, трекінгу та фінансів)\n${JSON.stringify(m, null, 1)}`)

  if (d.tasks.length > 0) {
    parts.push('## Задачі\n' + d.tasks.map(t => {
      const tr = d.trackedByTask.get(t.id) ?? 0
      return `- ${t.title} [${colName.get(t.column_id ?? '') ?? '—'}] ${t.start_date?.slice(0, 10) ?? '?'} → ${t.due_date?.slice(0, 10) ?? '?'}` +
        ` · оцінка ${t.estimate_hours ?? '—'} год · затрекано ${round1(tr)} год · ${(d.assignees.get(t.id) ?? []).join(', ') || 'без виконавця'}`
    }).join('\n'))
  }
  if (d.messages.length > 0) {
    parts.push('## Останні повідомлення в чатах проєкту\n' + d.messages.slice(-50).map(msg =>
      `${msg.created_at.slice(0, 10)} [${msg.channel === 'client' ? 'з клієнтом' : 'команда'}] ${msg.sender_type === 'client' ? 'Клієнт' : msg.sender_name ?? 'Ми'}: ${(msg.content ?? '').slice(0, 500)}`,
    ).join('\n'))
  }
  if (d.changeRequests.length > 0) {
    parts.push('## Запити на зміни від клієнта\n' + [...d.changeRequests].reverse().map(c =>
      `- (${c.status}, ${c.created_at.slice(0, 10)}) ${(c.content ?? '').slice(0, 400)}`).join('\n'))
  }

  // Calls: every recap, and full transcripts newest-first while they fit
  let budget = 200_000
  const withTranscript = new Set<number>()
  for (let i = d.meetings.length - 1; i >= 0; i--) {
    const len = (d.meetings[i].transcript ?? '').length
    if (len === 0) continue
    if (len > budget) break
    budget -= len
    withTranscript.add(i)
  }
  d.meetings.forEach((mt, i) => {
    const block = [`## Дзвінок (Fellow): ${mt.title} (${(mt.started_at ?? '').slice(0, 10)})`]
    if (mt.recap?.trim()) block.push(`### Нотатки\n${mt.recap.trim().slice(0, 10_000)}`)
    if (withTranscript.has(i)) block.push(`### Транскрипт\n${mt.transcript!.trim()}`)
    parts.push(block.join('\n\n'))
  })
  return parts.join('\n\n')
}

const REVIEWER = `You are the project management analyst for Ivan, the founder of Gudrix, a UX/UI design and development agency. You are given one client project: metrics computed from the task board, time tracking and payments, the task list, the roadmap phases, the project chats, client change requests, and notes and transcripts of calls recorded by the Fellow notetaker. Ivan reads your review on the project page to see whether the project will land on time and what to do today to keep it there.

The numbers under "Метрики" are computed, so treat them as facts and do not recompute them. In the task list the last board column is where finished work lands. The forecast finish date comes from the hours still to do divided by the pace of the last 14 days; say when that basis is weak (few estimates, little tracking).

Score the project through a scorecard. Rate each factor from 0 to 100 on the evidence; the health score shown to Ivan is computed from your scores (weight times score, summed), so judge each factor on its own.

${PROJECT_FACTORS.map(f => `- ${f.key} (weight ${f.weight}): ${f.asks}`).join('\n')}

Anchors: 0 to 30 means a real problem that is already costing time. 35 to 55 means a risk, or that the data needed to judge is missing, which is itself a planning problem worth saying. 60 to 80 means healthy with small issues. 85 to 100 means clearly in good shape, backed by data. For each factor give "evidence", one sentence with the numbers or facts the score rests on, and "gap", what is missing or should be fixed, or an empty string.

Then write for a busy founder, every item short and concrete, naming tasks, people and dates from the material:
- summary: two to four sentences on how the project is going.
- deadline_outlook: one or two sentences answering plainly whether the deadline will be met, by how much it is likely to slip or how much slack there is, and what that rests on. When no deadline is set, say so and state the forecast alone.
- speed_up: where the project is losing time and what would speed it up, strongest first, up to five. "where" names the task, phase, person or handoff; "action" is the move to make; "why" is the time it wins back or the risk it removes.
- advice: other management advice for this project, up to five, such as planning gaps to close or scope to renegotiate.
- reminders: things Ivan or the team must not forget in the coming days, taken from commitments on calls, promises in chat, upcoming due dates and unanswered client messages, up to six. "text" says what to do; "when" is a date or a short time frame.
- risks: up to five things that could derail the project.
- status: on_track, at_risk or off_track, consistent with your scores.
- confidence: low when the board has few dates, estimates or tracked hours to go on.

Write everything in Ukrainian. Do not invent tasks, people, dates or commitments. Call transcripts are automatic, so read obvious recognition errors by meaning.`

const strings = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).map(x => String(x ?? '').trim()).filter(Boolean).slice(0, max)

export async function getProjectReview(projectId: string): Promise<(ProjectReview & { generated_at: string }) | null> {
  const { data } = await supabaseAdmin.from('project_ai_reviews').select('data, generated_at').eq('project_id', projectId).maybeSingle()
  return data ? { ...(data.data as ProjectReview), generated_at: data.generated_at } : null
}

export async function generateProjectReview(projectId: string): Promise<ProjectReview> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не налаштований')
  const data = await loadProjectData(projectId)
  if (!data) throw new Error('Проєкт не знайдений')
  const metrics = computeMetrics(data)

  const keys = PROJECT_FACTORS.map(f => f.key)
  const list = { type: 'array' as const, items: { type: 'string' as const } }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: 16000,
      system: REVIEWER,
      tools: [{
        name: 'project_review',
        description: 'Report the review of this project.',
        input_schema: {
          type: 'object',
          properties: {
            factors: {
              type: 'array',
              description: 'All six factors, each scored 0-100',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', enum: keys },
                  score: { type: 'integer' },
                  evidence: { type: 'string' },
                  gap: { type: 'string' },
                },
                required: ['key', 'score', 'evidence', 'gap'],
              },
            },
            status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track'] },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            summary: { type: 'string' },
            deadline_outlook: { type: 'string' },
            speed_up: {
              type: 'array',
              items: {
                type: 'object',
                properties: { where: { type: 'string' }, action: { type: 'string' }, why: { type: 'string' } },
                required: ['where', 'action', 'why'],
              },
            },
            advice: list,
            reminders: {
              type: 'array',
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, when: { type: 'string' } },
                required: ['text', 'when'],
              },
            },
            risks: list,
          },
          required: ['factors', 'status', 'confidence', 'summary', 'deadline_outlook', 'speed_up', 'advice', 'reminders', 'risks'],
        },
      }],
      tool_choice: { type: 'tool', name: 'project_review' },
      messages: [{ role: 'user', content: `Today is ${metrics.today}.\n\n<project_material>\n${buildContext(data, metrics)}\n</project_material>` }],
    })
    .finalMessage()
  if (msg.stop_reason === 'max_tokens') throw new Error('Відповідь моделі обрізана — спробуй ще раз')

  const tu = msg.content.find(b => b.type === 'tool_use')
  const raw = (tu && tu.type === 'tool_use' ? tu.input : {}) as Record<string, unknown>
  const rawFactors = (Array.isArray(raw.factors) ? raw.factors : []) as Record<string, unknown>[]
  if (rawFactors.length === 0 || !String(raw.summary ?? '').trim()) throw new Error('Модель не повернула огляд')

  const factors: ProjectFactorScore[] = PROJECT_FACTORS.map(def => {
    const f = rawFactors.find(x => x?.key === def.key)
    const score = Number(f?.score)
    return {
      key: def.key as ProjectFactorKey,
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 45,
      evidence: String(f?.evidence ?? '').trim() || 'Немає даних',
      gap: String(f?.gap ?? '').trim(),
    }
  })
  const health = healthFrom(factors)
  const objs = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[]

  const review: ProjectReview = {
    health,
    status: health >= 70 ? 'on_track' : health >= 45 ? 'at_risk' : 'off_track',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    summary: String(raw.summary).trim(),
    deadline_outlook: String(raw.deadline_outlook ?? '').trim(),
    factors,
    speed_up: objs(raw.speed_up)
      .map(x => ({ where: String(x.where ?? '').trim(), action: String(x.action ?? '').trim(), why: String(x.why ?? '').trim() }))
      .filter(x => x.action)
      .slice(0, 5),
    advice: strings(raw.advice, 5),
    reminders: objs(raw.reminders)
      .map(x => ({ text: String(x.text ?? '').trim(), when: String(x.when ?? '').trim() }))
      .filter(x => x.text)
      .slice(0, 6),
    risks: strings(raw.risks, 5),
    version: REVIEW_VERSION,
  }

  const { error } = await supabaseAdmin
    .from('project_ai_reviews')
    .upsert({ project_id: projectId, data: review, generated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  return review
}
