import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: project }, { data: columns }, { data: tasks }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, name, color, status, contract_amount, contract_currency, show_tracked_hours')
      .eq('id', id)
      .single(),
    supabaseAdmin.from('pm_columns').select('id, name, color, position').eq('project_id', id).order('position'),
    supabaseAdmin
      .from('pm_tasks')
      .select('id, title, description, column_id, priority, due_date, created_at')
      .eq('finance_project_id', id)
      .order('created_at'),
  ])

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const taskIds = (tasks ?? []).map(t => t.id)

  // Assignee display names per task
  const assigneesByTask: Record<string, string[]> = {}
  if (taskIds.length > 0) {
    const [{ data: assignees }, { data: members }] = await Promise.all([
      supabaseAdmin.from('task_assignees').select('task_id, team_member_id').in('task_id', taskIds),
      supabaseAdmin.from('team_members').select('id, name, color'),
    ])
    const nameById: Record<string, string> = {}
    for (const m of members ?? []) nameById[m.id] = m.name
    for (const a of assignees ?? []) {
      const name = nameById[a.team_member_id]
      if (!name) continue
      if (!assigneesByTask[a.task_id]) assigneesByTask[a.task_id] = []
      assigneesByTask[a.task_id].push(name)
    }
  }

  // Tracked seconds per task — ONLY when the admin enabled it for this project
  let timeByTask: Record<string, number> | null = null
  if (project.show_tracked_hours && taskIds.length > 0) {
    const { data: entries } = await supabaseAdmin
      .from('time_entries')
      .select('task_id, duration_seconds')
      .in('task_id', taskIds)
      .not('ended_at', 'is', null)
    timeByTask = {}
    for (const e of entries ?? []) {
      timeByTask[e.task_id] = (timeByTask[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
    }
  }

  return NextResponse.json({
    project,
    columns: columns ?? [],
    tasks: tasks ?? [],
    assigneesByTask,
    timeByTask,
  })
}
