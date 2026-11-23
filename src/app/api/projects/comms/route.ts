import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'
import { imapConfig } from '@/lib/mailSync'
import { fellowConfig } from '@/lib/fellow'
import { syncFellow } from '@/lib/fellowSync'
import { getProjectMailState, syncProjectMail } from '@/lib/projectMail'
import { extractMeetingActions, extractPendingActions, listActions } from '@/lib/meetingActions'

// A project's communication with its client, in one place: the letters
// (pulled from the mailbox) and the action items taken from its calls.
// GET  ?project=   letters + action items + sync state
// POST { action: 'sync' }                      pull mail and Fellow now
// POST { action: 'extract', meetingId }        read one call's action items again

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface MailRow {
  id: string
  direction: 'in' | 'out'
  subject: string | null
  body: string | null
  from_email: string | null
  to_email: string | null
  sent_at: string
  message_id?: string | null
  automated?: boolean
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project')
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })

  const [{ data: own, error: ownErr }, { data: leads }] = await Promise.all([
    supabaseAdmin.from('project_emails').select('*').eq('project_id', projectId).order('sent_at', { ascending: false }).limit(400),
    supabaseAdmin.from('crm_leads').select('id').eq('project_id', projectId),
  ])
  // The lead this project grew from: its correspondence is part of the story
  const leadIds = (leads ?? []).map(l => l.id as string)
  const { data: fromLead } = leadIds.length
    ? await supabaseAdmin.from('lead_emails').select('*').in('lead_id', leadIds).order('sent_at', { ascending: false }).limit(200)
    : { data: [] as MailRow[] }

  const seen = new Set<string>()
  const emails: (MailRow & { source: 'project' | 'lead' })[] = []
  for (const [rows, source] of [[own ?? [], 'project'], [fromLead ?? [], 'lead']] as const) {
    for (const e of rows as MailRow[]) {
      const key = e.message_id || `${e.direction}|${e.subject}|${e.sent_at}`
      if (seen.has(key)) continue
      seen.add(key)
      emails.push({
        id: e.id, direction: e.direction, subject: e.subject, body: e.body, from_email: e.from_email, to_email: e.to_email,
        sent_at: e.sent_at, automated: !!e.automated, source,
      })
    }
  }
  emails.sort((a, b) => b.sent_at.localeCompare(a.sent_at))

  let actions: Awaited<ReturnType<typeof listActions>> = []
  let actionsError: string | null = null
  try { actions = await listActions(projectId) } catch (e) { actionsError = (e as Error).message }

  const state = await getProjectMailState().catch(() => ({}) as Awaited<ReturnType<typeof getProjectMailState>>)
  return NextResponse.json({
    emails,
    actions,
    needsMigration: !!ownErr || !!actionsError,
    mail: { configured: !!imapConfig(), last_synced_at: state.last_synced_at ?? null, last_error: state.last_error ?? null },
    ai: !!process.env.ANTHROPIC_API_KEY,
  })
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { action?: string; meetingId?: string } | null

  if (body?.action === 'extract') {
    if (typeof body.meetingId !== 'string') return NextResponse.json({ error: 'meetingId is required' }, { status: 400 })
    try {
      return NextResponse.json(await extractMeetingActions(body.meetingId, { force: true }))
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 })
    }
  }

  if (body?.action === 'sync') {
    const [mail, fellow] = await Promise.allSettled([
      imapConfig() ? syncProjectMail() : Promise.resolve(null),
      fellowConfig() ? syncFellow() : Promise.resolve(null),
    ])
    // syncFellow reads new calls' action items itself; this catches calls
    // attached by hand since
    const actions = await extractPendingActions().catch(e => ({ meetings: 0, created: 0, error: (e as Error).message }))
    const errors = [mail, fellow]
      .map(r => (r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason).slice(0, 200) : ''))
      .filter(Boolean)
    return NextResponse.json({
      mail: mail.status === 'fulfilled' ? mail.value : null,
      fellow: fellow.status === 'fulfilled' ? fellow.value : null,
      actions,
      errors,
    })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
