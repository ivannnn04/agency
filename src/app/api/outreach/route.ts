import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

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
