import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser } from '@/lib/portalAuth'

export async function GET(req: NextRequest) {
  const { email, client } = await getPortalUser(req)
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Authenticated but not attached to any project by the admin yet
  if (!client) return NextResponse.json({ email, client: null, projects: [] })

  const { data: links } = await supabaseAdmin
    .from('project_clients')
    .select('project_id')
    .eq('client_id', client.id)
  const projectIds = (links ?? []).map(l => l.project_id)

  let projects: unknown[] = []
  if (projectIds.length > 0) {
    const [{ data: projs }, { data: tasks }] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id, name, color, status, contract_amount, contract_currency')
        .in('id', projectIds),
      supabaseAdmin
        .from('pm_tasks')
        .select('id, finance_project_id')
        .in('finance_project_id', projectIds),
    ])
    projects = (projs ?? []).map(p => ({
      ...p,
      task_count: (tasks ?? []).filter(t => t.finance_project_id === p.id).length,
    }))
  }

  return NextResponse.json({
    email,
    client: { id: client.id, email: client.email, name: client.name },
    projects,
  })
}
