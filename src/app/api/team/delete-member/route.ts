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
  const { id } = await req.json()
  const admin = adminClient()

  const { data: member } = await admin
    .from('team_members')
    .select('supabase_user_id')
    .eq('id', id)
    .single()

  await admin.from('team_members').delete().eq('id', id)

  if (member?.supabase_user_id) {
    await admin.auth.admin.deleteUser(member.supabase_user_id)
  }

  return NextResponse.json({ ok: true })
}
