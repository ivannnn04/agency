import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Supabase Database Webhook target: fires on INSERT into `notifications`
// and `project_messages`, resolves who should hear about it and sends
// Web Push to every subscribed device of those people. This is the only
// place that covers ALL message sources — chats insert rows straight from
// the browser, so no app code path sees them.

export const dynamic = 'force-dynamic'

interface WebhookBody {
  table?: string
  type?: string
  record?: Record<string, unknown>
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

async function recipientsForMessage(r: Record<string, unknown>): Promise<string[]> {
  const senderKey = r.sender_type === 'admin'
    ? 'admin'
    : r.sender_type === 'team'
      ? `team-${str(r.team_member_id)}`
      : `client-${str(r.client_id)}`

  let keys: string[] = []
  const dmKey = str(r.dm_key)
  const chatId = str(r.chat_id)
  const projectId = str(r.project_id)

  if (dmKey) {
    keys = dmKey.split('|')
  } else if (chatId) {
    const { data: members } = await supabaseAdmin
      .from('general_chat_members').select('team_member_id').eq('chat_id', chatId)
    if (members && members.length > 0) {
      keys = members.map(m => `team-${m.team_member_id}`)
    } else {
      const { data: all } = await supabaseAdmin.from('team_members').select('id')
      keys = (all ?? []).map(m => `team-${m.id}`)
    }
    keys.push('admin')
  } else if (projectId) {
    const { data: members } = await supabaseAdmin
      .from('project_members').select('team_member_id').eq('project_id', projectId)
    keys = [...(members ?? []).map(m => `team-${m.team_member_id}`), 'admin']
  }

  return [...new Set(keys)].filter(k => k !== senderKey && !k.startsWith('client-'))
}

export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_WEBHOOK_SECRET
  if (secret && req.headers.get('x-push-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:gudrix.corporate@gmail.com', pub, priv)

  const body: WebhookBody = await req.json().catch(() => ({}))
  if (body.type !== 'INSERT' || !body.record) return NextResponse.json({ ok: true, skipped: true })

  let keys: string[] = []
  let title = 'Gudrix'
  let text = ''
  let tag = ''

  if (body.table === 'notifications') {
    const r = body.record
    const rid = str(r.recipient_team_member_id)
    keys = [rid ? `team-${rid}` : 'admin']
    text = str(r.message)
    tag = `notif-${str(r.id)}`
  } else if (body.table === 'project_messages') {
    const r = body.record
    keys = await recipientsForMessage(r)
    title = str(r.sender_name) || 'Нове повідомлення'
    text = str(r.content) || (str(r.file_url) ? '📎 Файл' : '')
    tag = `msg-${str(r.dm_key) || str(r.chat_id) || str(r.project_id)}`
  } else {
    return NextResponse.json({ ok: true, skipped: true })
  }

  if (keys.length === 0 || !text) return NextResponse.json({ ok: true, sent: 0 })

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_key, subscription')
    .in('user_key', keys)

  let sent = 0
  const dead: string[] = []
  await Promise.all((subs ?? []).map(async s => {
    const url = s.user_key === 'admin' ? '/chats' : '/team/dashboard'
    const payload = JSON.stringify({ title, body: text.slice(0, 140), url, tag })
    try {
      await webpush.sendNotification(s.subscription as webpush.PushSubscription, payload)
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id)
    }
  }))
  if (dead.length > 0) await supabaseAdmin.from('push_subscriptions').delete().in('id', dead)

  return NextResponse.json({ ok: true, sent })
}
