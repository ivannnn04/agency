import webpush from 'web-push'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Server-side Web Push to specific users ('admin' | 'team-<id>').
// Quietly does nothing when VAPID keys are not configured.
export async function sendPushTo(
  keys: string[],
  payload: { title: string; body: string; url: string; tag?: string },
): Promise<number> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv || keys.length === 0) return 0
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:gudrix.corporate@gmail.com', pub, priv)

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, subscription')
    .in('user_key', keys)

  let sent = 0
  const dead: string[] = []
  const body = JSON.stringify({ ...payload, body: payload.body.slice(0, 140) })
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification(s.subscription as webpush.PushSubscription, body)
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id)
    }
  }))
  if (dead.length > 0) await supabaseAdmin.from('push_subscriptions').delete().in('id', dead)
  return sent
}
