import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'
import { clientBoard } from '@/lib/clientColumns'
import { adminAssignees, billableAdminEntries } from '@/lib/adminTime'
import { clientBilling } from '@/lib/clientBilling'

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

  // Estimates for client-requested tasks and the formatted descriptions:
  // their columns come with later migrations, so they are read with '*'
  const { data: fullRows } = await supabaseAdmin
    .from('pm_tasks')
    .select('*')
    .eq('finance_project_id', id)
  const full = (fullRows ?? []) as Record<string, unknown>[]
  const estimateById = new Map(full.filter(e => e.estimate_status != null).map(e => [e.id as string, e]))
  const htmlById = new Map(full.filter(e => typeof e.description_html === 'string' && e.description_html).map(e => [e.id as string, e.description_html as string]))
  const tasksOut = (tasks ?? []).map(base => {
    const t = { ...base, description_html: htmlById.get(base.id) ?? null }
    const e = estimateById.get(t.id) as Record<string, unknown> | undefined
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

  // Subtasks, read-only for the client: what they are and which are done
  const subtasksByTask: Record<string, { title: string; done: boolean }[]> = {}
  if (taskIds.length > 0) {
    const { data: subs } = await supabaseAdmin
      .from('pm_subtasks').select('task_id, title, done, position').in('task_id', taskIds).order('position')
    for (const s of (subs ?? []) as { task_id: string; title: string; done: boolean }[]) {
      ;(subtasksByTask[s.task_id] ??= []).push({ title: s.title, done: !!s.done })
    }
  }

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
  // and per day (the date only — never the hours of the day work was done)
  let timeByTask: Record<string, number> | null = null
  let timeByDay: { day: string; tasks: { task_id: string; seconds: number }[] }[] | null = null
  if (project.show_tracked_hours) {
    timeByTask = {}
    timeByDay = []
  }
  if (timeByTask && timeByDay && taskIds.length > 0) {
    const { data: entries } = await supabaseAdmin
      .from('time_entries')
      .select('task_id, started_at, duration_seconds')
      .in('task_id', taskIds)
      .not('ended_at', 'is', null)
    // The admin's own time counts too, on tasks where it is marked for invoicing
    const all = [
      ...((entries ?? []) as { task_id: string; started_at: string | null; duration_seconds: number | null }[]),
      ...(await billableAdminEntries(taskIds)),
    ]
    const kyivDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' })
    const byDay = new Map<string, Map<string, number>>()
    for (const e of all) {
      const sec = e.duration_seconds ?? 0
      if (sec <= 0) continue
      timeByTask[e.task_id] = (timeByTask[e.task_id] ?? 0) + sec
      if (!e.started_at) continue
      const day = kyivDay.format(new Date(e.started_at))
      const tasksOfDay = byDay.get(day) ?? new Map<string, number>()
      tasksOfDay.set(e.task_id, (tasksOfDay.get(e.task_id) ?? 0) + sec)
      byDay.set(day, tasksOfDay)
    }
    timeByDay = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, m]) => ({
        day,
        tasks: [...m.entries()].map(([task_id, seconds]) => ({ task_id, seconds })).sort((a, b) => b.seconds - a.seconds),
      }))
  }

  // Money behind the hours — only when the admin also turned amounts on.
  // Read on its own: the settings arrive with a later migration.
  const { data: billingSettings } = await supabaseAdmin.from('projects').select('*').eq('id', id).maybeSingle()
  const billing = project.show_tracked_hours && timeByTask
    ? await clientBilling({ projectId: id, settings: billingSettings, columns: columns ?? [], timeByTask }).catch(() => null)
    : null

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
    timeByDay,
    subtasksByTask,
    billing,
    people,
    changeRequests: changeRequests ?? [],
  })
}
