import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { sendPushTo } from '@/lib/pushServer'

// Intake for the browser Claude agents that submit proposals on Dribbble/
// Behance: they POST every sent proposal here with the OUTREACH_API_KEY.
// GET (same key) lets an agent check what's already been logged.

function authorized(req: NextRequest) {
  const key = process.env.OUTREACH_API_KEY
  if (!key) return false
  const header = req.headers.get('authorization') ?? ''
  return header === `Bearer ${key}` || req.headers.get('x-api-key') === key
}

const SOURCES = ['dribbble', 'behance']
const SOURCE_LABEL: Record<string, string> = { dribbble: 'Dribbble', behance: 'Behance' }

// A replied proposal becomes a CRM lead on the /leads kanban (status "new").
// Idempotent: a proposal that already has a lead keeps it.
async function ensureLead(proposal: {
  id: string
  source: string
  job_title: string
  job_url: string | null
  client_name: string | null
  budget: string | null
  lead_id: string | null
}, clientReply?: string): Promise<string | null> {
  if (proposal.lead_id) return proposal.lead_id
  const notesParts = [
    clientReply && `Відповідь клієнта:\n${clientReply}`,
    proposal.job_url,
    proposal.budget && `Бюджет: ${proposal.budget}`,
  ]
  const { data: lead, error } = await supabaseAdmin
    .from('crm_leads')
    .insert({
      name: proposal.client_name || proposal.job_title,
      channel: SOURCE_LABEL[proposal.source] ?? proposal.source,
      status: 'new',
      notes: notesParts.filter(Boolean).join('\n\n'),
    })
    .select('id')
    .single()
  if (error || !lead) return null
  await supabaseAdmin.from('outreach_proposals').update({ lead_id: lead.id }).eq('id', proposal.id)
  return lead.id
}

// Agent updates a proposal: a client replied, we won/lost, etc.
// { id | job_url, status?, client_reply?, replied_at?, notes? }
// status "lead"/"replied" also creates the CRM lead automatically.
export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const id = body.id ? String(body.id) : null
  const jobUrl = body.job_url ? String(body.job_url) : null
  if (!id && !jobUrl) return NextResponse.json({ error: 'id or job_url is required' }, { status: 400 })

  let q = supabaseAdmin.from('outreach_proposals').select('*').limit(1)
  q = id ? q.eq('id', id) : q.eq('job_url', jobUrl!)
  const { data: rows, error: findErr } = await q
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 400 })
  const proposal = rows?.[0]
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const rawStatus = String(body.status ?? '').toLowerCase().trim()
  // "lead" is what the agents say; in the log it reads as "replied"
  const status = rawStatus === 'lead' ? 'replied' : rawStatus
  const wantsLead = rawStatus === 'lead' || rawStatus === 'replied'

  const patch: Record<string, unknown> = {}
  if (['sent', 'replied', 'won', 'lost'].includes(status)) patch.status = status

  // Client messages build a thread: every NEW message is logged and pushed;
  // an exact repeat (agent re-reading the dialog) is silently ignored
  let newReply = false
  const hadReplyBefore = !!proposal.client_reply
  if (body.client_reply) {
    const msg = String(body.client_reply).slice(0, 10000)
    const { data: dup, error: thrErr } = await supabaseAdmin
      .from('outreach_replies')
      .select('id')
      .eq('proposal_id', proposal.id)
      .eq('message', msg)
      .maybeSingle()
    if (thrErr) {
      // outreach_replies not migrated yet — fall back to the last stored reply
      newReply = msg !== proposal.client_reply
    } else if (!dup) {
      await supabaseAdmin.from('outreach_replies').insert({
        proposal_id: proposal.id,
        message: msg,
        ...(body.replied_at ? { created_at: body.replied_at } : {}),
      })
      newReply = true
    }
    patch.client_reply = msg
    patch.replied_at = body.replied_at ?? new Date().toISOString()
    // A fresh message bumps closed-nothing statuses back to "replied"
    if (!patch.status && proposal.status === 'sent') patch.status = 'replied'
  } else if (body.replied_at) {
    patch.replied_at = body.replied_at
  }
  if (body.notes) patch.notes = String(body.notes).slice(0, 5000)

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabaseAdmin
      .from('outreach_proposals')
      .update(patch)
      .eq('id', proposal.id)
    if (upErr) {
      const hint = upErr.message.includes('client_reply') || upErr.message.includes('replied_at')
        ? 'Run the client_reply/replied_at part of supabase/outreach_migration.sql'
        : upErr.message
      return NextResponse.json({ error: hint }, { status: 400 })
    }
  }

  let leadId = proposal.lead_id as string | null
  if (wantsLead) {
    leadId = await ensureLead(proposal, body.client_reply ? String(body.client_reply) : undefined)
  }

  // Push the admin's phone: on every NEW client message, and on the first
  // lead-marking even without text
  if (newReply || (wantsLead && !proposal.lead_id)) {
    const who = proposal.client_name || proposal.job_title
    const srcLabel = SOURCE_LABEL[proposal.source] ?? proposal.source
    await sendPushTo(['admin'], {
      title: newReply && hadReplyBefore
        ? `💬 ${who} написали ще (${srcLabel})`
        : `🎉 Відповідь на пропозал (${srcLabel})`,
      body: body.client_reply ? `${who}: ${String(body.client_reply)}` : `${who} відповіли на пропозал`,
      url: '/outreach',
      tag: `outreach-${proposal.id}-${Date.now()}`,
    })
  }

  return NextResponse.json({
    ok: true,
    id: proposal.id,
    status: (patch.status as string) ?? proposal.status,
    lead_id: leadId,
    lead_created: wantsLead && !proposal.lead_id && !!leadId,
    duplicate_reply: !!body.client_reply && !newReply,
  })
}

export async function POST(req: NextRequest) {
  if (!process.env.OUTREACH_API_KEY) {
    return NextResponse.json({ error: 'OUTREACH_API_KEY is not configured on the server' }, { status: 500 })
  }
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const rawSource = String(body.source ?? '').toLowerCase().trim()
  const source = SOURCES.includes(rawSource) ? rawSource : (rawSource || 'other')
  const jobTitle = String(body.job_title ?? body.title ?? '').slice(0, 300).trim()
  const jobUrl = body.job_url ? String(body.job_url).slice(0, 1000) : null

  if (!jobTitle && !jobUrl) {
    return NextResponse.json({ error: 'job_title or job_url is required' }, { status: 400 })
  }

  // The same job posted twice (agent retry) collapses into one row
  if (jobUrl) {
    const { data: existing } = await supabaseAdmin
      .from('outreach_proposals')
      .select('id')
      .eq('job_url', jobUrl)
      .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, id: existing.id, duplicate: true })
  }

  const { data, error } = await supabaseAdmin
    .from('outreach_proposals')
    .insert({
      source,
      job_title: jobTitle || jobUrl,
      job_url: jobUrl,
      client_name: body.client_name ? String(body.client_name).slice(0, 200) : null,
      budget: body.budget ? String(body.budget).slice(0, 100) : null,
      cover_letter: body.cover_letter ? String(body.cover_letter).slice(0, 10000) : '',
      sent_at: body.sent_at ?? new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) {
    const hint = error.message.includes('outreach_proposals')
      ? 'Run supabase/outreach_migration.sql' : error.message
    return NextResponse.json({ error: hint }, { status: 400 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = req.nextUrl.searchParams.get('job_url')
  let q = supabaseAdmin
    .from('outreach_proposals')
    .select('id, source, job_title, job_url, status, sent_at')
    .order('sent_at', { ascending: false })
    .limit(100)
  if (url) q = q.eq('job_url', url)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ proposals: data ?? [] })
}
