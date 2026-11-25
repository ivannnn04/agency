import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'
import { billableAdminEntries } from '@/lib/adminTime'
import { computeBilling, projectRate } from '@/lib/clientBilling'

// For the admin's project report: the admin's own tracked time per task (it
// lives apart from the team's, so the report could not see it), and what the
// tracked work comes to at the client's hourly rate — also when no budget is
// set and the client pays for hours as they go.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project') ?? ''
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })

  const [{ data: settings }, { data: columns }, { data: tasks }, { data: profile }] = await Promise.all([
    supabaseAdmin.from('projects').select('*').eq('id', projectId).maybeSingle(),
    supabaseAdmin.from('pm_columns').select('id, name').eq('project_id', projectId),
    supabaseAdmin.from('pm_tasks').select('*').eq('finance_project_id', projectId),
    supabaseAdmin.from('admin_profile').select('name').eq('id', 'main').maybeSingle(),
  ])
  if (!settings) return NextResponse.json({ error: 'Проєкт не знайдено' }, { status: 404 })
  const taskIds = (tasks ?? []).map(t => t.id as string)

  // The admin's own time: all of it counts as hours; only time on tasks
  // marked "invoice my time" counts towards what the client pays
  const adminByTask: Record<string, number> = {}
  if (taskIds.length) {
    const { data: own } = await supabaseAdmin
      .from('admin_time_entries').select('task_id, duration_seconds').in('task_id', taskIds).not('ended_at', 'is', null)
    for (const e of (own ?? []) as { task_id: string; duration_seconds: number | null }[]) {
      adminByTask[e.task_id] = (adminByTask[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
    }
  }
  const billableTasks = ((tasks ?? []) as { id: string; admin_time_billable?: boolean }[]).filter(t => t.admin_time_billable).map(t => t.id)

  // Billable time per task, exactly as the client's hours count it
  const timeByTask: Record<string, number> = {}
  if (taskIds.length) {
    const { data: team } = await supabaseAdmin
      .from('time_entries').select('task_id, duration_seconds').in('task_id', taskIds).not('ended_at', 'is', null)
    for (const e of [...((team ?? []) as { task_id: string; duration_seconds: number | null }[]), ...(await billableAdminEntries(taskIds))]) {
      timeByTask[e.task_id] = (timeByTask[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
    }
  }

  const s = settings as { client_hourly_rate?: number | null; contract_currency?: string | null }
  const billing = await computeBilling({ projectId, settings: s, columns: columns ?? [], timeByTask }).catch(() => null)
  return NextResponse.json({
    adminName: String((profile as { name?: string } | null)?.name ?? '').trim() || 'Ivan',
    adminByTask,
    billableTasks,
    rate: billing?.rate ?? (await projectRate(projectId, s)),
    rateIsSet: Number(s.client_hourly_rate) > 0,
    currency: s.contract_currency || 'USD',
    billing,
  })
}
