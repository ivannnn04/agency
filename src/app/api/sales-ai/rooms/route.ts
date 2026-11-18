import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Sales AI rooms (one per client/deal). Admin-only: the NextAuth middleware
// guards /api/sales-ai/*, and the tables have no RLS policies, so this
// service-role route is the only way in.

const MIGRATION_HINT = 'Запусти міграцію supabase/sales_ai_migration.sql'

function dbError(message: string) {
  const missing = message.includes('sales_rooms') || message.includes('sales_docs')
  return NextResponse.json({ error: missing ? MIGRATION_HINT : message }, { status: 400 })
}

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)
const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

export async function GET() {
  const [rooms, leads, projects] = await Promise.all([
    supabaseAdmin.from('sales_rooms').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('crm_leads').select('id, name').order('created_at', { ascending: false }),
    supabaseAdmin.from('projects').select('id, name').neq('status', 'archived').order('name'),
  ])
  if (rooms.error) return dbError(rooms.error.message)
  return NextResponse.json({
    rooms: rooms.data ?? [],
    leads: leads.data ?? [],
    projects: projects.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const name = str(body?.name, 200).trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('sales_rooms')
    .insert({
      name,
      about: str(body?.about, 20000),
      language: str(body?.language || 'auto', 10),
      lead_id: idOrNull(body?.lead_id),
      project_id: idOrNull(body?.project_id),
    })
    .select()
    .single()
  if (error) return dbError(error.message)
  return NextResponse.json({ room: data })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = idOrNull(body?.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('name' in body) patch.name = str(body.name, 200).trim() || 'Без назви'
  if ('about' in body) patch.about = str(body.about, 20000)
  if ('language' in body) patch.language = str(body.language || 'auto', 10)
  if ('lead_id' in body) patch.lead_id = idOrNull(body.lead_id)
  if ('project_id' in body) patch.project_id = idOrNull(body.project_id)
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { data, error } = await supabaseAdmin.from('sales_rooms').update(patch).eq('id', id).select().single()
  if (error) return dbError(error.message)
  return NextResponse.json({ room: data })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = idOrNull(body?.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('sales_rooms').delete().eq('id', id)
  if (error) return dbError(error.message)
  return NextResponse.json({ ok: true })
}
