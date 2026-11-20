import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { fellowConfig } from '@/lib/fellow'
import { getFellowState } from '@/lib/fellowSync'
import {
  REVIEW_VERSION, computeMetrics, generateProjectReview, getProjectReview, loadProjectData,
} from '@/lib/projectInsight'

// Project health: computed metrics, the AI review and the calls attached to
// a project. Admin-only via the NextAuth middleware.

export const maxDuration = 300

const BATCH = 3
const hint = (msg: string) =>
  /project_ai_reviews|project_milestones|project_id|schema cache/i.test(msg)
    ? 'Запусти міграцію supabase/project_program_migration.sql у Supabase SQL Editor'
    : msg.slice(0, 300)

async function activeProjects() {
  const { data } = await supabaseAdmin
    .from('projects').select('id, name, color, status, created_at').eq('status', 'active').order('created_at', { ascending: false })
  return data ?? []
}

async function fellowInfo() {
  const state = await getFellowState().catch(() => ({}) as Awaited<ReturnType<typeof getFellowState>>)
  return { configured: !!fellowConfig(), last_synced_at: state.last_synced_at ?? null, last_error: state.last_error ?? null }
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project')

  if (projectId) {
    const data = await loadProjectData(projectId)
    if (!data) return NextResponse.json({ error: 'Проєкт не знайдений' }, { status: 404 })
    // Calls not on any project yet — candidates to attach by hand
    const { data: candidates, error } = await supabaseAdmin
      .from('lead_meetings')
      .select('id, title, started_at, attendees')
      .is('project_id', null)
      .order('started_at', { ascending: false })
      .limit(40)
    return NextResponse.json({
      metrics: computeMetrics(data),
      review: await getProjectReview(projectId).catch(() => null),
      meetings: [...data.meetings].reverse(),
      candidates: candidates ?? [],
      needsMigration: !!error,
      fellow: await fellowInfo(),
    })
  }

  const projects = await activeProjects()
  const { data: reviews } = await supabaseAdmin.from('project_ai_reviews').select('project_id, data, generated_at')
  const reviewOf = new Map((reviews ?? []).map(r => [r.project_id as string, r]))
  const out = []
  for (let i = 0; i < projects.length; i += 5) {
    const chunk = await Promise.all(projects.slice(i, i + 5).map(async p => {
      const data = await loadProjectData(p.id)
      const r = reviewOf.get(p.id)
      return {
        id: p.id, name: p.name, color: p.color,
        metrics: data ? computeMetrics(data) : null,
        review: r ? {
          health: r.data?.health ?? 0, status: r.data?.status ?? 'at_risk', summary: r.data?.summary ?? '',
          deadline_outlook: r.data?.deadline_outlook ?? '', generated_at: r.generated_at,
        } : null,
      }
    }))
    out.push(...chunk)
  }
  return NextResponse.json({
    projects: out,
    pending: projects.filter(p => (reviewOf.get(p.id)?.data?.version ?? 0) < REVIEW_VERSION).length,
    fellow: await fellowInfo(),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  try {
    if (body?.all === true) {
      const projects = await activeProjects()
      const { data: reviews } = await supabaseAdmin.from('project_ai_reviews').select('project_id, data')
      const current = new Set((reviews ?? []).filter(r => (r.data?.version ?? 0) >= REVIEW_VERSION).map(r => r.project_id))
      const pending = projects.filter(p => !current.has(p.id))
      const res = await Promise.allSettled(pending.slice(0, BATCH).map(p => generateProjectReview(p.id)))
      const done = res.filter(r => r.status === 'fulfilled').length
      const failed = res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
      return NextResponse.json({
        done,
        remaining: pending.length - done,
        error: failed ? hint(String(failed.reason?.message ?? failed.reason)) : null,
      })
    }
    const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
    if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    const review = await generateProjectReview(projectId)
    return NextResponse.json({ review: { ...review, generated_at: new Date().toISOString() } })
  } catch (e) {
    return NextResponse.json({ error: hint((e as Error).message) }, { status: 502 })
  }
}
