import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Set or reset a team member's login password.
// - If they already have a Supabase auth account → update its password.
// - If not (e.g. legacy token-only members) → create an auth account and link it.
export async function POST(req: Request) {
  const { id, password, email } = await req.json()

  if (!id || !password) {
    return NextResponse.json({ error: 'Потрібні учасник та пароль' }, { status: 400 })
  }
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'Пароль має бути мінімум 6 символів' }, { status: 400 })
  }

  const admin = adminClient()

  const { data: member, error: memErr } = await admin
    .from('team_members')
    .select('id, email, supabase_user_id')
    .eq('id', id)
    .single()

  if (memErr || !member) {
    return NextResponse.json({ error: 'Учасника не знайдено' }, { status: 404 })
  }

  // Already has an auth account → just update the password
  if (member.supabase_user_id) {
    const { error } = await admin.auth.admin.updateUserById(member.supabase_user_id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, created: false })
  }

  // No auth account yet → need an email to create one
  const useEmail = (email && String(email).trim()) || member.email
  if (!useEmail) {
    return NextResponse.json({ error: 'У учасника немає email — додайте email, щоб створити вхід' }, { status: 400 })
  }

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: useEmail,
    password,
    email_confirm: true,
  })
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const { error: linkErr } = await admin
    .from('team_members')
    .update({ supabase_user_id: authData.user.id, ...(member.email ? {} : { email: useEmail }) })
    .eq('id', id)

  if (linkErr) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: linkErr.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, created: true, email: useEmail })
}
