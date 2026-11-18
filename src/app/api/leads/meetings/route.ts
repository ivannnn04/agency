import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getFellowState } from '@/lib/fellowSync'
import { generateLeadOverview } from '@/lib/leadInsight'

// Sort a synced meeting by hand: attach it to a lead, create a lead from it,
// detach it, or mark it as not a sales call. Admin-only via the middleware.

export const maxDuration = 120

const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|proton|protonmail|ukr|i|meta)\.[a-z.]+$/

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: meeting, error: mErr } = await supabaseAdmin
    .from('lead_meetings').select('id, title, attendees, lead_id').eq('id', id).maybeSingle()
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 })
  if (!meeting) return NextResponse.json({ error: 'Зустріч не знайдена' }, { status: 404 })

  if (body.ignored === true) {
    await supabaseAdmin.from('lead_meetings').update({ ignored: true, lead_id: null }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (body.lead_id === null) {
    await supabaseAdmin.from('lead_meetings').update({ lead_id: null, match_reason: null, ignored: false }).eq('id', id)
    if (meeting.lead_id) generateLeadOverview(meeting.lead_id).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  // The first attendee from outside our own company is the client's contact
  const state = await getFellowState().catch(() => ({ own_email: '' }))
  const own = (state.own_email ?? '').toLowerCase()
  const ownDomain = own && !FREE_MAIL.test(own) ? own.split('@')[1] : ''
  const external = ((meeting.attendees ?? []) as string[]).filter(e => e !== own && (!ownDomain || !e.endsWith('@' + ownDomain)))

  let leadId = typeof body.lead_id === 'string' ? body.lead_id : ''
  let created = null
  if (body.create_lead === true) {
    const { data, error } = await supabaseAdmin
      .from('crm_leads')
      .insert({
        name: String(body.name ?? meeting.title).trim().slice(0, 120) || 'Новий лід',
        email: external[0] ?? null,
        channel: 'Fellow',
        status: 'contacted',
      })
      .select()
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Не вдалося створити ліда' }, { status: 400 })
    created = data
    leadId = data.id
  }
  if (!leadId) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('lead_meetings')
    .update({ lead_id: leadId, match_reason: 'manual', ignored: false })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Remember the contact so the next call with them is matched automatically
  if (!created && external[0]) {
    const { data: lead } = await supabaseAdmin.from('crm_leads').select('email').eq('id', leadId).maybeSingle()
    if (lead && !lead.email) await supabaseAdmin.from('crm_leads').update({ email: external[0] }).eq('id', leadId)
  }

  let overview = null
  try { overview = await generateLeadOverview(leadId) } catch { /* can be generated from the card */ }
  return NextResponse.json({ ok: true, lead: created, lead_id: leadId, overview })
}
