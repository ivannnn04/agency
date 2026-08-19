import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Accepts a team invitation: validates our invite token, sets the member's
// password, and hands back the email so the client can sign in right away.
// GET just validates the token (for the welcome page greeting) without
// consuming it.

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function findByToken(token: string) {
  const admin = adminClient()
  const { data: member } = await admin
    .from('team_members')
    .select('id, name, email, supabase_user_id, invite_token, invite_expires_at')
    .eq('invite_token', token)
    .single()
  if (!member) return { member: null, admin, reason: 'Лінк недійсний — можливо, вже використаний. Попроси нове запрошення.' }
  if (member.invite_expires_at && member.invite_expires_at < new Date().toISOString()) {
    return { member: null, admin, reason: 'Запрошення застаріло. Попроси адміністратора надіслати нове.' }
  }
  return { member, admin, reason: null }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Немає токена' }, { status: 400 })

  const { member, reason } = await findByToken(token)
  if (!member) return NextResponse.json({ error: reason }, { status: 400 })

  return NextResponse.json({ name: member.name, email: member.email })
}

export async function POST(req: NextRequest) {
  const { token, password } = await req.json()
  if (!token || !password) return NextResponse.json({ error: 'Потрібні токен і пароль' }, { status: 400 })
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'Пароль має бути мінімум 6 символів' }, { status: 400 })
  }

  const { member, admin, reason } = await findByToken(token)
  if (!member) return NextResponse.json({ error: reason }, { status: 400 })
  if (!member.email) return NextResponse.json({ error: 'У запрошення немає email — попроси нове' }, { status: 400 })

  // Set the password on the auth account (create it if the invite predates one)
  if (member.supabase_user_id) {
    const { error } = await admin.auth.admin.updateUserById(member.supabase_user_id, {
      password,
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: member.email,
      password,
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await admin.from('team_members').update({ supabase_user_id: created.user.id }).eq('id', member.id)
  }

  // Token is single-use: clear it now that the password is set
  await admin
    .from('team_members')
    .update({ invite_token: null, invite_expires_at: null })
    .eq('id', member.id)

  return NextResponse.json({ ok: true, email: member.email })
}
