// Browser side of Web Push: register the service worker, subscribe this
// device, and hand the subscription to our API keyed by who is logged in
// ('admin' | 'team-<id>').

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

async function subscribeAndStore(userKey: string) {
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set')
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userKey, subscription: sub.toJSON() }),
  })
  if (!res.ok) throw new Error('Не вдалося зберегти підписку')
}

// Explicit opt-in (button click) — may show the permission prompt
export async function enablePush(userKey: string): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  await subscribeAndStore(userKey)
  return 'ok'
}

// Silent refresh on app load — keeps the stored subscription current on
// devices that already granted permission
export async function refreshPush(userKey: string) {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    await subscribeAndStore(userKey)
  } catch { /* best effort */ }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
  await sub.unsubscribe()
}

export function pushEnabled(): boolean {
  return pushSupported() && Notification.permission === 'granted'
}
