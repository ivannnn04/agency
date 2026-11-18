import supabaseAdmin from '@/lib/supabaseAdmin'

// Everything the sales assistant should know about a client before/while a
// call runs: the room brief, the linked CRM lead and project, and every
// stored document / previous meeting. The text is deterministic for
// unchanged data — the live-hint route relies on that for prompt caching.

export interface SalesRoom {
  id: string
  name: string
  about: string | null
  language: string | null
  lead_id: string | null
  project_id: string | null
  created_at: string
}

// ~100k tokens of background at most; newest material wins when over budget
const CONTEXT_BUDGET_CHARS = 400_000

const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10)

export async function leadSection(leadId: string): Promise<string | null> {
  const { data: lead } = await supabaseAdmin
    .from('crm_leads')
    .select('name, email, amount, currency, channel, status, notes')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return null

  const out: string[] = ['## CRM-лід']
  out.push(
    [
      `Імʼя: ${lead.name}`,
      lead.email && `Email: ${lead.email}`,
      lead.amount && `Сума угоди: ${lead.amount} ${lead.currency ?? ''}`,
      lead.channel && `Канал: ${lead.channel}`,
      `Статус у воронці: ${lead.status}`,
    ].filter(Boolean).join('\n'),
  )
  if (lead.notes?.trim()) out.push(`Нотатки по ліду:\n${lead.notes.trim()}`)

  const { data: emails } = await supabaseAdmin
    .from('lead_emails')
    .select('direction, subject, body, sent_at')
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: true })
    .limit(20)
  for (const e of emails ?? []) {
    out.push(`Лист (${e.direction === 'in' ? 'від клієнта' : 'від нас'}, ${day(e.sent_at)}): ${e.subject ?? ''}\n${(e.body ?? '').slice(0, 4000)}`)
  }

  // Outreach history that turned into this lead (proposal + the client's replies)
  const { data: proposals } = await supabaseAdmin
    .from('outreach_proposals')
    .select('id, source, job_title, job_url, budget, cover_letter')
    .eq('lead_id', leadId)
  for (const p of proposals ?? []) {
    out.push(
      `Пропозал (${p.source}) на «${p.job_title}»${p.budget ? `, бюджет ${p.budget}` : ''}${p.job_url ? `, ${p.job_url}` : ''}:\n${(p.cover_letter ?? '').slice(0, 6000)}`,
    )
    const { data: replies } = await supabaseAdmin
      .from('outreach_replies')
      .select('message, created_at')
      .eq('proposal_id', p.id)
      .order('created_at', { ascending: true })
    for (const r of replies ?? []) out.push(`Відповідь клієнта (${day(r.created_at)}): ${r.message.slice(0, 4000)}`)
  }
  return out.join('\n\n')
}

// Calls with this lead recorded by the Fellow notetaker. Recaps always go in;
// full transcripts are added newest-first while the budget lasts.
export async function leadMeetingsSection(leadId: string, budgetChars: number): Promise<string | null> {
  const { data: meetings } = await supabaseAdmin
    .from('lead_meetings')
    .select('title, started_at, recap, transcript')
    .eq('lead_id', leadId)
    .eq('ignored', false)
    .order('started_at', { ascending: true })
  if (!meetings || meetings.length === 0) return null

  const withTranscript = new Set<number>()
  let left = budgetChars
  for (let i = meetings.length - 1; i >= 0; i--) {
    const len = (meetings[i].transcript ?? '').length
    if (len === 0) continue
    if (len > left) break
    left -= len
    withTranscript.add(i)
  }
  return meetings
    .map((m, i) => {
      const parts = [`## Дзвінок (Fellow): ${m.title} (${day(m.started_at)})`]
      if (m.recap?.trim()) parts.push(`### Нотатки Fellow\n${m.recap.trim().slice(0, 12_000)}`)
      if (withTranscript.has(i)) parts.push(`### Транскрипт\n${m.transcript!.trim()}`)
      else if (m.transcript?.trim()) parts.push('(Транскрипт не вмістився в контекст — спирайся на нотатки.)')
      return parts.join('\n\n')
    })
    .join('\n\n')
}

async function projectSection(projectId: string): Promise<string | null> {
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('name, status, contract_amount, contract_currency')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null

  const out: string[] = ['## Проєкт, який ми вже ведемо для клієнта']
  out.push(
    `Назва: ${project.name}\nСтатус: ${project.status}${project.contract_amount ? `\nКонтракт: ${project.contract_amount} ${project.contract_currency ?? ''}` : ''}`,
  )

  const [{ data: columns }, { data: tasks }, { data: messages }, { data: crs }] = await Promise.all([
    supabaseAdmin.from('pm_columns').select('id, name').eq('project_id', projectId),
    supabaseAdmin
      .from('pm_tasks')
      .select('title, column_id, due_date')
      .eq('finance_project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('project_messages')
      .select('sender_type, sender_name, content, created_at')
      .eq('project_id', projectId)
      .eq('channel', 'client')
      .order('created_at', { ascending: false })
      .limit(40),
    supabaseAdmin
      .from('change_requests')
      .select('content, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const colName: Record<string, string> = {}
  for (const c of columns ?? []) colName[c.id] = c.name
  if (tasks && tasks.length > 0) {
    out.push(
      'Задачі (статус):\n' +
        tasks.map(t => `- ${t.title} [${colName[t.column_id ?? ''] ?? '—'}]${t.due_date ? ` до ${day(t.due_date)}` : ''}`).join('\n'),
    )
  }
  if (messages && messages.length > 0) {
    out.push(
      'Останні повідомлення в чаті з клієнтом:\n' +
        [...messages].reverse()
          .map(m => `${day(m.created_at)} ${m.sender_type === 'client' ? 'Клієнт' : 'Ми'} (${m.sender_name}): ${(m.content ?? '').slice(0, 600)}`)
          .join('\n'),
    )
  }
  if (crs && crs.length > 0) {
    out.push(
      'Запити на зміни від клієнта:\n' +
        [...crs].reverse().map(c => `- (${c.status}, ${day(c.created_at)}) ${(c.content ?? '').slice(0, 400)}`).join('\n'),
    )
  }
  return out.join('\n\n')
}

// excludeDocId: the meeting being recorded right now — its content is the
// live transcript, which the caller passes separately.
export async function buildSalesContext(
  roomId: string,
  excludeDocId?: string | null,
): Promise<{ room: SalesRoom; context: string } | null> {
  const { data: room } = await supabaseAdmin.from('sales_rooms').select('*').eq('id', roomId).maybeSingle()
  if (!room) return null

  const parts: string[] = [`# Клієнт / угода: ${room.name}`]
  if (room.about?.trim()) parts.push(`## Бриф від Івана\n${room.about.trim()}`)

  if (room.lead_id) {
    const s = await leadSection(room.lead_id).catch(() => null)
    if (s) parts.push(s)
    const m = await leadMeetingsSection(room.lead_id, 150_000).catch(() => null)
    if (m) parts.push(m)
  }
  if (room.project_id) {
    const s = await projectSection(room.project_id).catch(() => null)
    if (s) parts.push(s)
  }

  const { data: docs } = await supabaseAdmin
    .from('sales_docs')
    .select('id, kind, title, content, summary, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  const rendered = (docs ?? [])
    .filter(d => d.id !== excludeDocId && ((d.content ?? '').trim() || (d.summary ?? '').trim()))
    .map(d => {
      const head = d.kind === 'meeting'
        ? `## Попередня зустріч: ${d.title} (${day(d.created_at)})`
        : `## Матеріал: ${d.title} (${day(d.created_at)})`
      const summary = d.summary?.trim() ? `### Підсумок\n${d.summary.trim()}\n\n` : ''
      const body = (d.content ?? '').trim()
      return `${head}\n${summary}${d.kind === 'meeting' && body ? '### Транскрипт\n' : ''}${body}`
    })

  // Over budget → drop the OLDEST material first, keep chronological order
  let used = parts.join('\n\n').length
  const kept: string[] = []
  for (let i = rendered.length - 1; i >= 0; i--) {
    if (used + rendered[i].length > CONTEXT_BUDGET_CHARS) break
    used += rendered[i].length
    kept.unshift(rendered[i])
  }
  if (kept.length < rendered.length) {
    parts.push(`(Найстаріші матеріали — ${rendered.length - kept.length} шт. — не вмістились у контекст.)`)
  }
  parts.push(...kept)

  return { room: room as SalesRoom, context: parts.join('\n\n') }
}
