import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'
import { suggestEstimate } from '@/lib/preEstimate'

// Clients can add tasks — but only into the project's Backlog column.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, description } = await req.json()
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  // Find the backlog column; create one if the board doesn't have it yet
  const { data: columns } = await supabaseAdmin
    .from('pm_columns')
    .select('id, name, position')
    .eq('project_id', id)
    .order('position')

  let backlog = (columns ?? []).find(c => c.name.toLowerCase().includes('backlog'))
  if (!backlog) {
    const minPos = (columns ?? []).length > 0 ? Math.min(...(columns ?? []).map(c => c.position ?? 0)) : 0
    const { data: created, error: colErr } = await supabaseAdmin
      .from('pm_columns')
      .insert({ project_id: id, name: 'BACKLOG', color: '#9CA3AF', position: minPos - 1 })
      .select('id, name, position')
      .single()
    if (colErr || !created) {
      return NextResponse.json({ error: colErr?.message ?? 'Could not create the backlog column' }, { status: 500 })
    }
    backlog = created
  }

  const clientName = client.name || client.email
  const baseTask = {
    title: cleanTitle.slice(0, 200),
    description: String(description ?? '').trim().slice(0, 4000) || null,
    finance_project_id: id,
    column_id: backlog.id,
    priority: 'medium',
  }
  // Auto pre-estimate from the title; falls back if the column isn't migrated yet
  let { data: task, error } = await supabaseAdmin
    .from('pm_tasks')
    .insert({ ...baseTask, estimate_hours: suggestEstimate(baseTask.title) })
    .select('id, title, description, column_id, priority, start_date, due_date, created_at')
    .single()
  if (error && error.message.includes('estimate_hours')) {
    ;({ data: task, error } = await supabaseAdmin
      .from('pm_tasks')
      .insert(baseTask)
      .select('id, title, description, column_id, priority, start_date, due_date, created_at')
      .single())
  }

  if (error || !task) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 400 })

  // Ping the admin bell so the request doesn't sit unnoticed in the backlog
  const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', id).single()
  await supabaseAdmin.from('notifications').insert({
    type: 'client_task',
    message: `Клієнт ${clientName} додав задачу «${task.title}» у беклог проєкту «${project?.name ?? ''}»`,
    project_id: id,
    task_id: task.id,
    recipient_team_member_id: null,
  })

  return NextResponse.json(task)
}
