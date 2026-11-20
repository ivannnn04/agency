import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { fellowConfig } from '@/lib/fellow'
import { getFellowState } from '@/lib/fellowSync'
import { getMailState, imapConfig } from '@/lib/mailSync'
import { generateLeadOverview, getAgencyProfile, OVERVIEW_VERSION, setAgencyProfile } from '@/lib/leadInsight'

// AI overviews and Fellow meetings for the leads board. Admin-only via the
// NextAuth middleware; the tables themselves are closed to the anon key.

export const maxDuration = 300

const BATCH = 4

// Open leads whose overview is missing or predates the current set of sections
async function pendingLeadIds(): Promise<string[]> {
  const [{ data: leads }, { data: overviews }] = await Promise.all([
    supabaseAdmin.from('crm_leads').select('id, status, created_at').order('created_at', { ascending: false }),
    supabaseAdmin.from('lead_ai_overviews').select('lead_id, data'),
  ])
  const current = new Set((overviews ?? []).filter(o => (o.data?.version ?? 1) >= OVERVIEW_VERSION).map(o => o.lead_id))
  return (leads ?? []).filter(l => l.status !== 'won' && l.status !== 'lost' && !current.has(l.id)).map(l => l.id)
}

const MIGRATION_HINT = 'Запусти міграцію supabase/fellow_migration.sql у Supabase SQL Editor'
const missingTable = (msg: string) => /lead_meetings|lead_ai_overviews|integration_state|schema cache/i.test(msg)

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead')

  if (leadId) {
    const [{ data: ov, error }, { data: meetings }] = await Promise.all([
      supabaseAdmin.from('lead_ai_overviews').select('data, generated_at').eq('lead_id', leadId).maybeSingle(),
      supabaseAdmin
        .from('lead_meetings')
        .select('id, title, started_at, ended_at, attendees, recap, transcript, match_reason')
        .eq('lead_id', leadId)
        .eq('ignored', false)
        .order('started_at', { ascending: false }),
    ])
    if (error) return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 400 })
    return NextResponse.json({
      overview: ov ? { ...ov.data, generated_at: ov.generated_at } : null,
      meetings: meetings ?? [],
    })
  }

  const { data: overviews, error } = await supabaseAdmin.from('lead_ai_overviews').select('lead_id, data, generated_at')
  type MeetingRow = { id: string; lead_id: string | null; project_id?: string | null; title: string; started_at: string | null; attendees: string[]; ignored: boolean }
  let meetings: MeetingRow[] | null = null
  {
    const full = await supabaseAdmin
      .from('lead_meetings')
      .select('id, lead_id, project_id, title, started_at, attendees, ignored')
      .order('started_at', { ascending: false })
    meetings = full.data as MeetingRow[] | null
    if (full.error) {
      // project_id is added by a later migration
      const basic = await supabaseAdmin
        .from('lead_meetings')
        .select('id, lead_id, title, started_at, attendees, ignored')
        .order('started_at', { ascending: false })
      meetings = basic.data as MeetingRow[] | null
    }
  }
  if (error) {
    return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message, needsMigration: missingTable(error.message) }, { status: 400 })
  }

  const scores: Record<string, { win_probability: number; confidence: string; next_step: string; generated_at: string }> = {}
  for (const o of overviews ?? []) {
    scores[o.lead_id] = {
      win_probability: o.data?.win_probability ?? 0,
      confidence: o.data?.confidence ?? 'low',
      next_step: o.data?.next_step ?? '',
      generated_at: o.generated_at,
    }
  }
  const meetingStats: Record<string, { count: number; last: string | null }> = {}
  for (const m of meetings ?? []) {
    if (!m.lead_id || m.ignored) continue
    const s = (meetingStats[m.lead_id] ??= { count: 0, last: null })
    s.count++
    if (m.started_at && (!s.last || m.started_at > s.last)) s.last = m.started_at
  }
  const unmatched = (meetings ?? [])
    .filter(m => !m.lead_id && !m.project_id && !m.ignored)
    .map(m => ({ id: m.id, title: m.title, started_at: m.started_at, attendees: m.attendees }))

  const state = await getFellowState().catch(() => ({}) as Awaited<ReturnType<typeof getFellowState>>)
  const [pending, agencyProfile, mail] = await Promise.all([
    pendingLeadIds().catch(() => [] as string[]),
    getAgencyProfile().catch(() => ''),
    getMailState().catch(() => ({}) as Awaited<ReturnType<typeof getMailState>>),
  ])
  return NextResponse.json({
    scores,
    meetingStats,
    unmatched,
    pending: pending.length,
    agency_profile: agencyProfile,
    mail: {
      configured: !!imapConfig(),
      last_synced_at: mail.last_synced_at ?? null,
      last_error: mail.last_error ?? null,
    },
    fellow: {
      configured: !!fellowConfig(),
      last_synced_at: state.last_synced_at ?? null,
      last_error: state.last_error ?? null,
      webhook: !!state.webhook_id,
    },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)

  // One batch of the "overview for every lead" run; the page calls again
  // until nothing remains
  if (body?.all === true) {
    try {
      const ids = await pendingLeadIds()
      const batch = ids.slice(0, BATCH)
      const res = await Promise.allSettled(batch.map(id => generateLeadOverview(id)))
      const done = res.filter(r => r.status === 'fulfilled').length
      const firstError = res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
      return NextResponse.json({
        done,
        failed: batch.length - done,
        remaining: ids.length - done,
        error: firstError ? String(firstError.reason?.message ?? firstError.reason).slice(0, 200) : null,
      })
    } catch (e) {
      const msg = (e as Error).message
      return NextResponse.json({ error: missingTable(msg) ? MIGRATION_HINT : msg.slice(0, 300) }, { status: 502 })
    }
  }

  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  try {
    const overview = await generateLeadOverview(leadId)
    return NextResponse.json({ overview: { ...overview, generated_at: new Date().toISOString() } })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.json({ error: missingTable(msg) ? MIGRATION_HINT : msg.slice(0, 300) }, { status: 502 })
  }
}

// What Gudrix can show a client (cases, links, decks) — fed into every overview
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (typeof body?.agency_profile !== 'string') return NextResponse.json({ error: 'agency_profile is required' }, { status: 400 })
  try {
    await setAgencyProfile(body.agency_profile)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.json({ error: missingTable(msg) ? MIGRATION_HINT : msg.slice(0, 300) }, { status: 400 })
  }
}
