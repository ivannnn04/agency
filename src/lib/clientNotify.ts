import nodemailer from 'nodemailer'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { mailFrom, mailFromAddress } from '@/lib/mailer'
import { clientMessageEmail, clientReviewEmail, BuiltMail, MailLang } from '@/lib/clientEmails'
import { isClientReviewColumn } from '@/lib/reviewColumn'

// Emails to a project's clients so they never miss what happens on the
// Gudrix Platform: a team message in the client chat, a task ready for review.

export interface Recipient { email: string; name: string | null; lang: MailLang }

export async function projectRecipients(projectId: string): Promise<Recipient[]> {
  const { data: links } = await supabaseAdmin
    .from('project_clients')
    .select('clients(*)')
    .eq('project_id', projectId)
  return ((links ?? []) as unknown as { clients: { email?: string; name?: string | null; lang?: string } | null }[])
    .map(l => l.clients)
    .filter((c): c is { email: string; name?: string | null; lang?: string } => !!c?.email)
    .map(c => ({ email: c.email, name: c.name ?? null, lang: c.lang === 'uk' ? 'uk' : 'en' }))
}

export function appOrigin(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL || fallback || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
}

export const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] ?? ''

export interface NotifyResult { sent: number; error?: string; skipped?: string }

export async function deliver(to: Recipient[], build: (r: Recipient) => BuiltMail): Promise<NotifyResult> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { sent: 0, error: 'SMTP is not configured' }
  if (to.length === 0) return { sent: 0 }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: Number(SMTP_PORT ?? 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
  let sent = 0, error: string | undefined
  await Promise.all(to.map(async r => {
    const m = build(r)
    try {
      await transporter.sendMail({ from: mailFrom(), to: r.email, subject: m.subject, html: m.html, text: m.text })
      sent++
    } catch (e) {
      error = e instanceof Error ? e.message : 'SMTP error'
    }
  }))
  return { sent, error }
}

// The agency's own inbox for platform events: the admin sign-in addresses,
// or the sending mailbox when none are configured.
export async function mailAdmins(mail: BuiltMail): Promise<NotifyResult> {
  const list = (process.env.ALLOWED_EMAIL ?? '').split(',').map(e => e.trim()).filter(Boolean)
  const to = (list.length ? list : [mailFromAddress()]).map(email => ({ email, name: null, lang: 'uk' as MailLang }))
  return deliver(to, () => mail)
}

// A row inserted into project_messages. Only what the team writes in the
// client channel of a project goes out; the client's own messages and the
// internal channel never do.
export async function notifyClientMessage(record: Record<string, unknown>, origin?: string): Promise<NotifyResult> {
  const projectId = typeof record.project_id === 'string' ? record.project_id : ''
  if (!projectId || record.channel !== 'client' || record.sender_type === 'client') return { sent: 0, skipped: 'not a team message to the client' }

  const content = typeof record.content === 'string' ? record.content : ''
  const files = Array.isArray(record.files) ? (record.files as { name?: string }[]).map(f => f?.name ?? '').filter(Boolean) : []
  if (files.length === 0 && typeof record.file_name === 'string' && record.file_name) files.push(record.file_name)
  if (!content.trim() && files.length === 0) return { sent: 0, skipped: 'empty message' }

  const [{ data: project }, to] = await Promise.all([
    supabaseAdmin.from('projects').select('name').eq('id', projectId).maybeSingle(),
    projectRecipients(projectId),
  ])
  if (!project || to.length === 0) return { sent: 0, skipped: 'no clients on the project' }

  const base = appOrigin(origin)
  return deliver(to, r => clientMessageEmail({
    lang: r.lang,
    firstName: firstName(r.name),
    senderName: typeof record.sender_name === 'string' ? record.sender_name : '',
    projectName: project.name,
    message: content,
    fileNames: files,
    chatUrl: `${base}/portal/project/${projectId}?chat=1`,
  }))
}

// A task has just been moved. Sends the review letter when it now sits in a
// client-review column. The task is re-read here, so the caller cannot make
// this send anything that is not true, and a task dragged back and forth is
// announced once per half hour at most.
const REVIEW_QUIET_MS = 30 * 60 * 1000

export async function notifyClientTaskReview(taskId: string, origin?: string): Promise<NotifyResult> {
  const { data: task } = await supabaseAdmin
    .from('pm_tasks')
    .select('id, title, description, column_id, finance_project_id, team_member_id')
    .eq('id', taskId)
    .maybeSingle()
  if (!task?.column_id || !task.finance_project_id) return { sent: 0, skipped: 'task not found' }

  const { data: column } = await supabaseAdmin.from('pm_columns').select('name').eq('id', task.column_id).maybeSingle()
  if (!isClientReviewColumn(column?.name)) return { sent: 0, skipped: 'not a review column' }

  const key = `client_review_mail:${task.id}`
  const { data: state } = await supabaseAdmin.from('integration_state').select('value').eq('key', key).maybeSingle()
  const last = Number((state?.value as { at?: number } | null)?.at ?? 0)
  if (Date.now() - last < REVIEW_QUIET_MS) return { sent: 0, skipped: 'already announced recently' }

  const projectId = task.finance_project_id as string
  const [{ data: project }, to, { data: extra }] = await Promise.all([
    supabaseAdmin.from('projects').select('name').eq('id', projectId).maybeSingle(),
    projectRecipients(projectId),
    supabaseAdmin.from('task_assignees').select('team_member_id').eq('task_id', task.id),
  ])
  if (!project || to.length === 0) return { sent: 0, skipped: 'no clients on the project' }

  const memberIds = [...new Set([task.team_member_id, ...(extra ?? []).map(a => a.team_member_id)].filter(Boolean))] as string[]
  let madeBy: string[] = []
  if (memberIds.length) {
    const { data: members } = await supabaseAdmin.from('team_members').select('id, name').in('id', memberIds)
    madeBy = (members ?? []).map(m => String(m.name ?? '').trim().split(/\s+/)[0]).filter(Boolean)
  }

  // Mark first: two boards reporting the same move must not send twice
  await supabaseAdmin.from('integration_state').upsert({ key, value: { at: Date.now() }, updated_at: new Date().toISOString() })

  const base = appOrigin(origin)
  const link = `${base}/portal/project/${projectId}`
  return deliver(to, r => clientReviewEmail({
    lang: r.lang,
    firstName: firstName(r.name),
    projectName: project.name,
    taskTitle: task.title,
    taskDescription: task.description ?? '',
    madeBy,
    taskUrl: `${link}?view=board&task=${task.id}`,
    chatUrl: `${link}?chat=1`,
  }))
}
