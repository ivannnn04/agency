import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'
import { hashPassword } from '../route'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  return session?.user?.role === 'admin'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json()
  const update: Record<string, unknown> = {}
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
  if (typeof body.password === 'string' && body.password.trim()) {
    update.password_hash = hashPassword(body.password)
  }
  const { data, error } = await supabase
    .from('lead_managers')
    .update(update)
    .eq('id', id)
    .select('id,name,email,is_active,created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  await supabase.from('lead_managers').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
