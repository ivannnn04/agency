import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Stores/removes a device's push subscription. Called from the admin app
// and the team dashboard (each sends its own user_key).

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const userKey = String(body?.userKey ?? '')
  const subscription = body?.subscription
  const endpoint = String(subscription?.endpoint ?? '')
  if (!/^(admin|team-[0-9a-f-]{36})$/.test(userKey) || !endpoint.startsWith('https://')) {
    return NextResponse.json({ error: 'Bad subscription' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ user_key: userKey, endpoint, subscription }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const endpoint = String(body?.endpoint ?? '')
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return NextResponse.json({ ok: true })
}
