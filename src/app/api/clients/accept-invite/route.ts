import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Accepts a client portal invitation: validates our invite token, sets the
// client's password, and hands back the email so the page can sign them in.
// GET just validates the token (for the welcome greeting) without consuming it.

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function findByToken(token: string) {
  const admin = adminClient()
  const { data: client } = await admin
    .from('clients')
    .select('id, name, email, auth_user_id, invite_token, invite_expires_at')
    .eq('invite_token', token)
    .single()
  if (!client) return { client: null, admin, reason: 'This link is invalid — it may have already been used. Please ask for a new invitation.' }
  if (client.invite_expires_at && client.invite_expires_at < new Date().toISOString()) {
    return { client: null, admin, reason: 'This invitation has expired. Please ask your Gudrix contact to send a new one.' }
  }
  return { client, admin, reason: null }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { client, reason } = await findByToken(token)
  if (!client) return NextResponse.json({ error: reason }, { status: 400 })

  return NextResponse.json({ name: client.name, email: client.email })
}

export async function POST(req: NextRequest) {
  const { token, password } = await req.json()
  if (!token || !password) return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const { client, admin, reason } = await findByToken(token)
  if (!client) return NextResponse.json({ error: reason }, { status: 400 })

  // Set the password on the auth account (create it if the invite predates one)
  if (client.auth_user_id) {
    const { error } = await admin.auth.admin.updateUserById(client.auth_user_id, {
      password,
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: client.email,
      password,
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await admin.from('clients').update({ auth_user_id: created.user.id }).eq('id', client.id)
  }

  // Token is single-use: clear it now that the password is set
  await admin
    .from('clients')
    .update({ invite_token: null, invite_expires_at: null })
    .eq('id', client.id)

  return NextResponse.json({ ok: true, email: client.email })
}
