import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'

// The admin's own time on tasks: a timer, manual entries, a per-task
// "invoice my time" switch, and a per-project summary for the dashboard.
// Stored apart from the team's time entries, so it never reaches payroll.

export const dynamic = 'force-dynamic'

const HINT = 'Запусти міграцію supabase/admin_time_migration.sql у Supabase SQL Editor'
const fail = (msg: string, status = 400) =>
  NextResponse.json({ error: /admin_time|schema cache|does not exist/i.test(msg) ? HINT : msg }, { status })

interface Entry { id: string; task_id: string; project_id: string | null; started_at: string; ended_at: string | null; duration_seconds: number | null }

async function taskState(taskId: string) {
  const [{ data: entries, error }, { data: task }] = await Promise.all([
    supabaseAdmin.from('admin_time_entries').select('*').eq('task_id', taskId).order('started_at', { ascending: false }),
    supabaseAdmin.from('pm_tasks').select('*').eq('id', taskId).maybeSingle(),
  ])
  if (error) return { error: error.message }
  const list = (entries ?? []) as Entry[]
  return {
    total_seconds: list.filter(e => e.ended_at).reduce((s, e) => s + (e.duration_seconds ?? 0), 0),
    running: list.find(e => !e.ended_at) ?? null,
    entries: list.filter(e => e.ended_at).slice(0, 20),
    billable: !!(task as { admin_time_billable?: boolean } | null)?.admin_time_billable,
  }
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const taskId = req.nextUrl.searchParams.get('task')
  if (taskId) {
    const s = await taskState(taskId)
    return 'error' in s && s.error ? fail(s.error) : NextResponse.json(s)
  }

  // Summary: where the admin's time went, per project, for a month and overall
  const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
  const only = req.nextUrl.searchParams.get('project')
  let q = supabaseAdmin.from('admin_time_entries').select('*').not('ended_at', 'is', null)
  if (only) q = q.eq('project_id', only)
  const { data: entries, error } = await q
  if (error) return fail(error.message)
  const list = (entries ?? []) as Entry[]

  const taskIds = [...new Set(list.map(e => e.task_id))]
  const projectIds = [...new Set(list.map(e => e.project_id).filter(Boolean))] as string[]
  const [{ data: tasks }, { data: projects }] = await Promise.all([
    taskIds.length ? supabaseAdmin.from('pm_tasks').select('*').in('id', taskIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabaseAdmin.from('projects').select('id, name, color').in('id', projectIds) : Promise.resolve({ data: [] }),
  ])
  const billable = new Set(((tasks ?? []) as { id: string; admin_time_billable?: boolean }[]).filter(t => t.admin_time_billable).map(t => t.id))

  const rows = new Map<string, { month: number; month_billable: number; total: number; total_billable: number }>()
  for (const e of list) {
    const key = e.project_id ?? 'none'
    const r = rows.get(key) ?? { month: 0, month_billable: 0, total: 0, total_billable: 0 }
    const sec = e.duration_seconds ?? 0, bill = billable.has(e.task_id)
    r.total += sec
    if (bill) r.total_billable += sec
    if (e.started_at.slice(0, 7) === month) { r.month += sec; if (bill) r.month_billable += sec }
    rows.set(key, r)
  }
  const out = [...rows.entries()].map(([id, r]) => {
    const p = (projects ?? []).find(x => x.id === id)
    return { project_id: id === 'none' ? null : id, name: p?.name ?? 'Без проєкту', color: p?.color ?? null, ...r }
  }).sort((a, b) => b.month - a.month || b.total - a.total)

  return NextResponse.json({ month, projects: out })
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
  const action = body?.action
  if (!taskId || !['start', 'stop', 'add'].includes(action)) return fail('taskId and action are required')

  const { data: task } = await supabaseAdmin.from('pm_tasks').select('id, finance_project_id').eq('id', taskId).maybeSingle()
  if (!task) return fail('Задачу не знайдено', 404)
  const now = new Date()

  // Stopping closes whatever is running; starting does that first, so only one timer runs at a time
  if (action === 'start' || action === 'stop') {
    const { data: open, error } = await supabaseAdmin.from('admin_time_entries').select('*').is('ended_at', null)
    if (error) return fail(error.message)
    for (const e of (open ?? []) as Entry[]) {
      if (action === 'stop' && e.task_id !== taskId) continue
      const seconds = Math.max(0, Math.round((now.getTime() - new Date(e.started_at).getTime()) / 1000))
      await supabaseAdmin.from('admin_time_entries').update({ ended_at: now.toISOString(), duration_seconds: seconds }).eq('id', e.id)
    }
  }
  if (action === 'start') {
    const { error } = await supabaseAdmin.from('admin_time_entries').insert({ task_id: taskId, project_id: task.finance_project_id, started_at: now.toISOString() })
    if (error) return fail(error.message)
  }
  if (action === 'add') {
    const seconds = Math.round(Number(body.seconds))
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) return fail('Вкажи час від хвилини до 24 годин')
    const { error } = await supabaseAdmin.from('admin_time_entries').insert({
      task_id: taskId, project_id: task.finance_project_id,
      started_at: new Date(now.getTime() - seconds * 1000).toISOString(), ended_at: now.toISOString(), duration_seconds: seconds,
    })
    if (error) return fail(error.message)
  }
  const s = await taskState(taskId)
  return 'error' in s && s.error ? fail(s.error) : NextResponse.json(s)
}

// Should the admin's time on this task go on the client's invoice
export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
  if (!taskId || typeof body.billable !== 'boolean') return fail('taskId and billable are required')
  const { error } = await supabaseAdmin.from('pm_tasks').update({ admin_time_billable: body.billable }).eq('id', taskId)
  if (error) return fail(error.message)
  const s = await taskState(taskId)
  return 'error' in s && s.error ? fail(s.error) : NextResponse.json(s)
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const taskId = req.nextUrl.searchParams.get('task') ?? ''
  if (!id || !taskId) return fail('id and task are required')
  const { error } = await supabaseAdmin.from('admin_time_entries').delete().eq('id', id).eq('task_id', taskId)
  if (error) return fail(error.message)
  const s = await taskState(taskId)
  return 'error' in s && s.error ? fail(s.error) : NextResponse.json(s)
}
