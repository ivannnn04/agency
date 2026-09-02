import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { suggestEstimate } from '@/lib/preEstimate'

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

  const base = {
    title,
    finance_project_id,
    column_id,
    team_member_id: team_member_id ?? null,
    status: 'todo',
    priority: 'medium',
  }

  // Auto pre-estimate from the title (people forget to set it manually);
  // stays editable. Fall back without the field if the column doesn't exist yet.
  let { data: task, error } = await admin
    .from('pm_tasks')
    .insert({ ...base, estimate_hours: suggestEstimate(title) })
    .select()
    .single()
  if (error && error.message.includes('estimate_hours')) {
    ;({ data: task, error } = await admin.from('pm_tasks').insert(base).select().single())
  }

  if (error || !task) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 400 })

  await admin.from('notifications').insert({
    type: 'task_created',
    message: `${created_by} створив задачу «${title}» у проєкті ${project_name ?? ''}`,
    project_id: finance_project_id,
    task_id: task.id,
    team_member_id: team_member_id ?? null,
  })

  return NextResponse.json({ task })
}
