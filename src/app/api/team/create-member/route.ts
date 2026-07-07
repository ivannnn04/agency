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
  const { name, email, password, role, color } = await req.json()

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Імʼя, email та пароль обовʼязкові' }, { status: 400 })
  }

  const admin = adminClient()

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const { data, error } = await admin
    .from('team_members')
    .insert({
      name,
      email,
      role: role || 'designer',
      color: color || '#14b8a6',
      supabase_user_id: authData.user.id,
    })
    .select()
    .single()

  if (error) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ member: data })
}
