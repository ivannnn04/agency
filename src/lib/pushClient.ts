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
  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  } catch {
    throw new Error('Не вдалося запустити service worker — онови сторінку (Cmd+Shift+R) і спробуй ще раз')
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) {
    throw new Error('У Vercel не додано NEXT_PUBLIC_VAPID_PUBLIC_KEY (або не було Redeploy після додавання)')
  }
  let sub: PushSubscription
  try {
    sub = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
  } catch (e) {
    throw new Error(`Браузер не дав створити підписку: ${(e as Error).message}`)
  }
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userKey, subscription: sub.toJSON() }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(`Не вдалося зберегти підписку: ${error}`)
  }
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
