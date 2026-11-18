import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { fellowConfig } from '@/lib/fellow'
import { getFellowState } from '@/lib/fellowSync'
import { generateLeadOverview } from '@/lib/leadInsight'

// AI overviews and Fellow meetings for the leads board. Admin-only via the
// NextAuth middleware; the tables themselves are closed to the anon key.

export const maxDuration = 120

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

  const [{ data: overviews, error }, { data: meetings }] = await Promise.all([
    supabaseAdmin.from('lead_ai_overviews').select('lead_id, data, generated_at'),
    supabaseAdmin
      .from('lead_meetings')
      .select('id, lead_id, title, started_at, attendees, ignored')
      .order('started_at', { ascending: false }),
  ])
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
    .filter(m => !m.lead_id && !m.ignored)
    .map(m => ({ id: m.id, title: m.title, started_at: m.started_at, attendees: m.attendees }))

  const state = await getFellowState().catch(() => ({}) as Awaited<ReturnType<typeof getFellowState>>)
  return NextResponse.json({
    scores,
    meetingStats,
    unmatched,
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
