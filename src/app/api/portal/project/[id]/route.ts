import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'
import { clientBoard } from '@/lib/clientColumns'
import { adminAssignees, billableAdminTime } from '@/lib/adminTime'

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

  const [{ data: project }, { data: columns }, { data: tasks }, { data: pmRows }, { data: changeRequests }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, name, color, status, contract_amount, contract_currency, show_tracked_hours, change_request_limit')
      .eq('id', id)
      .single(),
    supabaseAdmin.from('pm_columns').select('id, name, color, position').eq('project_id', id).order('position'),
    supabaseAdmin
      .from('pm_tasks')
      .select('id, title, description, column_id, priority, start_date, due_date, created_at')
      .eq('finance_project_id', id)
      .order('created_at'),
    supabaseAdmin.from('project_members').select('team_members(name)').eq('project_id', id),
    supabaseAdmin
      .from('change_requests')
      .select('id, task_id, content, files, status, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Programme: overall dates and roadmap phases. Read separately because
  // they arrive with a later migration and the portal must work without them.
  const [{ data: dates }, { data: phases }] = await Promise.all([
    supabaseAdmin.from('projects').select('start_date, deadline').eq('id', id).maybeSingle(),
    supabaseAdmin
      .from('project_milestones')
      .select('id, title, start_date, end_date, done')
      .eq('project_id', id)
      .order('position'),
  ])

  // Estimates for client-requested tasks; the columns come with a later migration
  const { data: estimates } = await supabaseAdmin
    .from('pm_tasks')
    .select('*')
    .eq('finance_project_id', id)
    .not('estimate_status', 'is', null)
  const estimateById = new Map((estimates ?? []).map(e => [e.id as string, e]))
  const tasksOut = (tasks ?? []).map(t => {
    const e = estimateById.get(t.id)
    if (!e) return t
    const waiting = e.estimate_status === 'sent'
    return {
      ...t,
      estimate_status: e.estimate_status,
      // The numbers are shown to the client only once the team has sent them
      estimate_hours: waiting || e.estimate_status === 'approved' ? e.estimate_hours : null,
      estimate_rate: waiting ? (e.estimate_rate ?? null) : null,
      estimate_cost: waiting || e.estimate_status === 'approved' ? e.estimate_cost : null,
      estimate_note: waiting ? e.estimate_note : null,
      estimate_client_comment: e.estimate_status === 'changes' ? e.estimate_client_comment : null,
    }
  })

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

  // A task the admin took themselves shows the admin among its assignees
  for (const [taskId, name] of Object.entries(await adminAssignees(taskIds))) {
    assigneesByTask[taskId] = [name, ...(assigneesByTask[taskId] ?? []).filter(n => n !== name)]
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
    // The admin's own time counts too, on tasks where it is marked for invoicing
    const own = await billableAdminTime(taskIds)
    for (const [taskId, seconds] of Object.entries(own)) {
      timeByTask[taskId] = (timeByTask[taskId] ?? 0) + seconds
    }
  }

  // People the client can @mention in chat: admin + team members on the project
  const people = [
    'Ivan',
    ...(pmRows ?? [])
      .map(r => (r as unknown as { team_members: { name: string } | null }).team_members?.name)
      .filter((n): n is string => !!n),
  ]

  return NextResponse.json({
    project: { ...project, start_date: dates?.start_date ?? null, deadline: dates?.deadline ?? null },
    phases: phases ?? [],
    lang: client.lang === 'uk' ? 'uk' : 'en',
    // 'To be invoiced' is internal: the client sees those tasks as Done
    ...clientBoard(columns ?? [], tasksOut),
    assigneesByTask,
    timeByTask,
    people,
    changeRequests: changeRequests ?? [],
  })
}
