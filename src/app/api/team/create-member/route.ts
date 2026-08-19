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
  const { name, email, password, role, color, hourly_rate_usd } = await req.json()

  if (!name || !email) {
    return NextResponse.json({ error: 'Імʼя та email обовʼязкові' }, { status: 400 })
  }

  const admin = adminClient()

  // Password is optional: without it the member gets an email invitation and
  // sets their own password on first login (the invite route creates the
  // auth account).
  let supabaseUserId: string | null = null
  if (password) {
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })
    supabaseUserId = authData.user.id
  }

  const { data, error } = await admin
    .from('team_members')
    .insert({
      name,
      email,
      role: role || 'designer',
      color: color || '#14b8a6',
      hourly_rate_usd: Number(hourly_rate_usd) || 0,
      supabase_user_id: supabaseUserId,
    })
    .select()
    .single()

  if (error) {
    if (supabaseUserId) await admin.auth.admin.deleteUser(supabaseUserId)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ member: data })
}
