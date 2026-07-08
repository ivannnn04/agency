import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: Request) {
  const { title, finance_project_id, column_id, team_member_id, created_by, project_name } = await req.json()

  if (!title || !finance_project_id || !column_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = adminClient()

  const { data: task, error } = await admin
    .from('pm_tasks')
    .insert({
      title,
      finance_project_id,
      column_id,
      team_member_id: team_member_id ?? null,
      status: 'todo',
      priority: 'medium',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await admin.from('notifications').insert({
    type: 'task_created',
    message: `${created_by} створив задачу «${title}» у проєкті ${project_name ?? ''}`,
    project_id: finance_project_id,
    task_id: task.id,
    team_member_id: team_member_id ?? null,
  })

  return NextResponse.json({ task })
}
