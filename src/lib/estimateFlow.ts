import supabaseAdmin from '@/lib/supabaseAdmin'
import { agencyNoticeEmail, clientEstimateEmail } from '@/lib/clientEmails'
import { appOrigin, deliver, firstName, mailAdmins, projectRecipients } from '@/lib/clientNotify'
import { addEstimateToBudget } from '@/lib/projectBudget'

// Client-requested tasks go through an estimate before they reach the board:
//   client adds a task        → status 'needed', no column, team + admin told
//   team sends the estimate   → status 'sent', the client is emailed
//   client comments           → status 'changes', team + admin told
//   client approves           → status 'approved', the task lands in To-Do
// While the status is needed/sent/changes the task lives in the virtual
// "To be estimated" column that both boards and the client workspace show.

export const ESTIMATE_PENDING = ['needed', 'sent', 'changes']

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
export const money = (n: number, currency: string | null | undefined) =>
  `${SYMBOL[currency ?? 'USD'] ?? ''}${Number(n).toLocaleString('en-US')}`

interface FlowTask {
  id: string
  title: string
  description: string | null
  finance_project_id: string | null
  estimate_status: string | null
  estimate_hours: number | null
  estimate_rate?: number | null
  estimate_cost: number | null
  estimate_note: string | null
  estimate_sent_at: string | null
}

async function loadTask(taskId: string): Promise<FlowTask | null> {
  const { data } = await supabaseAdmin
    .from('pm_tasks')
    .select('*')   // tolerant of estimate columns that arrive with later migrations
    .eq('id', taskId)
    .maybeSingle()
  return (data as FlowTask | null) ?? null
}

// Where an approved task goes: the board's To-Do (or Backlog), else its first
// column. A board with no columns gets a To-Do so the task cannot vanish.
export async function todoColumnId(projectId: string): Promise<string | null> {
  const { data: columns } = await supabaseAdmin
    .from('pm_columns')
    .select('id, name, position')
    .eq('project_id', projectId)
    .order('position')
  const list = columns ?? []
  const named = list.find(c => /to.?do|backlog|беклог/i.test(c.name ?? ''))
  if (named) return named.id
  if (list[0]) return list[0].id
  const { data: created } = await supabaseAdmin
    .from('pm_columns')
    .insert({ project_id: projectId, name: 'TO DO', color: '#F59E0B', position: 0 })
    .select('id')
    .single()
  return created?.id ?? null
}

// The admin bell and the bell of everyone on the project
async function notifyTeam(projectId: string, taskId: string, type: string, message: string) {
  const { data: members } = await supabaseAdmin.from('project_members').select('team_member_id').eq('project_id', projectId)
  const rows = [null, ...new Set((members ?? []).map(m => m.team_member_id as string))].map(recipient => ({
    type, message, project_id: projectId, task_id: taskId, recipient_team_member_id: recipient,
  }))
  await supabaseAdmin.from('notifications').insert(rows)
}

async function projectOf(projectId: string) {
  const { data } = await supabaseAdmin.from('projects').select('name, contract_currency').eq('id', projectId).maybeSingle()
  return { name: data?.name ?? '', currency: (data?.contract_currency as string | null) ?? 'USD' }
}

// 1. A client has just added a task
export async function announceClientTask(taskId: string, clientName: string, origin?: string) {
  const task = await loadTask(taskId)
  if (!task?.finance_project_id) return
  const project = await projectOf(task.finance_project_id)
  await notifyTeam(task.finance_project_id, task.id, 'client_task',
    `Клієнт ${clientName} додав задачу «${task.title}» у проєкті «${project.name}» — потрібна оцінка`)
  await mailAdmins(agencyNoticeEmail({
    subject: `Нова задача від клієнта — ${project.name}`,
    eyebrow: 'Потрібна оцінка',
    headline: `${clientName} додав задачу`,
    lines: [`Проєкт «${project.name}». Оцініть задачу й надішліть оцінку клієнту — у To-Do вона потрапить після його погодження.`],
    quote: task.title + (task.description ? `\n${task.description.slice(0, 400)}` : ''),
    cta: { label: 'Відкрити дошку', url: `${appOrigin(origin)}/board/${task.finance_project_id}` },
  }))
}

// 2. The team sends (or re-sends) the estimate to the client
export async function sendEstimate(taskId: string, origin?: string): Promise<{ ok: boolean; sent?: number; error?: string }> {
  const task = await loadTask(taskId)
  if (!task?.finance_project_id) return { ok: false, error: 'Задачу не знайдено' }
  if (!ESTIMATE_PENDING.includes(task.estimate_status ?? '')) return { ok: false, error: 'Ця задача не чекає на оцінку' }
  const hours = Number(task.estimate_hours ?? 0), rate = Number(task.estimate_rate ?? 0)
  if (!(hours > 0)) return { ok: false, error: 'Вкажи години' }
  // Hours × hourly rate; a total without a rate (older estimates) is kept as is
  const cost = rate > 0 ? Math.round(hours * rate * 100) / 100 : Number(task.estimate_cost ?? 0)
  // A double click must not send two letters
  if (task.estimate_status === 'sent' && task.estimate_sent_at && Date.now() - new Date(task.estimate_sent_at).getTime() < 60_000) {
    return { ok: true, sent: 0 }
  }

  const projectId = task.finance_project_id
  const [project, to] = await Promise.all([projectOf(projectId), projectRecipients(projectId)])
  if (to.length === 0) return { ok: false, error: 'До проєкту не додано жодного клієнта' }

  const revised = task.estimate_status === 'changes' || !!task.estimate_sent_at
  const { error } = await supabaseAdmin
    .from('pm_tasks')
    .update({ estimate_status: 'sent', estimate_sent_at: new Date().toISOString(), estimate_cost: cost > 0 ? cost : null })
    .eq('id', task.id)
  if (error) return { ok: false, error: error.message }

  const link = `${appOrigin(origin)}/portal/project/${projectId}`
  const r = await deliver(to, rcp => clientEstimateEmail({
    lang: rcp.lang,
    firstName: firstName(rcp.name),
    projectName: project.name,
    taskTitle: task.title,
    hours,
    rate: rate > 0 ? money(rate, project.currency) : null,
    cost: cost > 0 ? money(cost, project.currency) : null,
    note: task.estimate_note ?? '',
    revised,
    taskUrl: `${link}?view=board&task=${task.id}`,
    chatUrl: `${link}?chat=1`,
  }))
  // The estimate is visible in the workspace even if the mail failed
  return { ok: true, sent: r.sent, error: r.error }
}

// 3. The client approves the estimate or asks to change it
export async function decideEstimate(o: {
  taskId: string
  projectId: string
  clientName: string
  action: 'approve' | 'comment'
  comment: string
  origin?: string
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const task = await loadTask(o.taskId)
  if (!task || task.finance_project_id !== o.projectId) return { ok: false, status: 404, error: 'Task not found' }
  if (task.estimate_status !== 'sent') return { ok: false, status: 409, error: 'This estimate is not waiting for a decision' }

  const project = await projectOf(o.projectId)
  const board = `${appOrigin(o.origin)}/board/${o.projectId}`
  const now = new Date().toISOString()

  if (o.action === 'approve') {
    const column = await todoColumnId(o.projectId)
    if (!column) return { ok: false, status: 500, error: 'The board has no columns' }
    const { error } = await supabaseAdmin
      .from('pm_tasks')
      .update({ estimate_status: 'approved', estimate_decided_at: now, column_id: column })
      .eq('id', task.id)
    if (error) return { ok: false, status: 500, error: error.message }
    // A priced estimate extends the project budget by its price
    const budget = await addEstimateToBudget(task.id)
    const grew = budget.added > 0 ? ` Бюджет проєкту збільшено на ${money(budget.added, project.currency)}.` : ''
    await notifyTeam(o.projectId, task.id, 'estimate_approved',
      `${o.clientName} погодив оцінку задачі «${task.title}» — вона в To-Do проєкту «${project.name}».${grew}`)
    await mailAdmins(agencyNoticeEmail({
      subject: `Клієнт погодив оцінку — ${task.title}`,
      eyebrow: 'Оцінку погоджено',
      headline: `${o.clientName} погодив оцінку`,
      lines: [`Задача «${task.title}» у проєкті «${project.name}» уже в To-Do — можна брати в роботу.${grew}`],
      cta: { label: 'Відкрити дошку', url: board },
    }))
    return { ok: true }
  }

  const comment = o.comment.trim().slice(0, 2000)
  if (!comment) return { ok: false, status: 400, error: 'Comment is required' }
  const { error } = await supabaseAdmin
    .from('pm_tasks')
    .update({ estimate_status: 'changes', estimate_client_comment: comment, estimate_decided_at: now })
    .eq('id', task.id)
  if (error) return { ok: false, status: 500, error: error.message }
  await notifyTeam(o.projectId, task.id, 'estimate_changes',
    `${o.clientName} просить змінити оцінку задачі «${task.title}» у проєкті «${project.name}»: ${comment.slice(0, 140)}`)
  await mailAdmins(agencyNoticeEmail({
    subject: `Клієнт просить змінити оцінку — ${task.title}`,
    eyebrow: 'Коментар до оцінки',
    headline: `${o.clientName} не погодив оцінку`,
    lines: [`Задача «${task.title}» у проєкті «${project.name}». Перегляньте оцінку й надішліть її ще раз.`],
    quote: comment,
    cta: { label: 'Відкрити дошку', url: board },
  }))
  return { ok: true }
}
