import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Staying signed in ────────────────────────────────────────────────────────
// Team members and clients stay signed in until they sign out themselves.
// The session sits in localStorage as usual; on top of that its refresh token
// is mirrored to a long-lived server cookie (/api/portal/keep-session). When
// the browser has wiped localStorage on its own (Safari does after a week
// without a visit), the session is restored from that cookie, silently.

const KEEP = '/api/portal/keep-session'
const KEPT = 'gudrix:keptToken'          // which token the cookie already holds
const HEADERS = { 'Content-Type': 'application/json', 'x-gudrix-session': '1' }

const isSessionKey = (key: string) => key.endsWith('-auth-token')
// Only the team and client areas use a Supabase session
const usesSession = () => /^\/(team|portal|start)(\/|$)/.test(window.location.pathname)

const local = {
  get: (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* storage blocked */ } },
  remove: (k: string) => { try { window.localStorage.removeItem(k) } catch { /* storage blocked */ } },
}

function refreshTokenOf(value: string): string | null {
  try {
    const token = JSON.parse(value)?.refresh_token
    return typeof token === 'string' ? token : null
  } catch {
    return null
  }
}

// Mirror the current refresh token to the cookie (once per token)
function remember(value: string) {
  const token = refreshTokenOf(value)
  if (!token || token === local.get(KEPT)) return
  local.set(KEPT, token)
  fetch(KEEP, { method: 'POST', headers: HEADERS, body: JSON.stringify({ refresh_token: token }), keepalive: true })
    .then(r => { if (!r.ok) local.remove(KEPT) })
    .catch(() => local.remove(KEPT))
}

let restoring: Promise<string | null> | null = null

const durableStorage = {
  async getItem(key: string): Promise<string | null> {
    const value = local.get(key)
    if (!isSessionKey(key)) return value
    if (value) { remember(value); return value }
    if (!usesSession()) return null
    // Nothing stored locally: ask the server once per page load
    restoring ??= fetch(KEEP, { headers: HEADERS, cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.session ? JSON.stringify(d.session) : null))
      .catch(() => null)
    const restored = await restoring
    if (restored && !local.get(key)) {
      local.set(key, restored)
      const token = refreshTokenOf(restored)
      if (token) local.set(KEPT, token)
    }
    return local.get(key) ?? restored
  },
  setItem(key: string, value: string) {
    local.set(key, value)
    if (isSessionKey(key)) remember(value)
  },
  removeItem(key: string) {
    local.remove(key)
    if (!isSessionKey(key)) return
    // Signed out (or the session was revoked): forget the cookie too, and do
    // not bring the session back during this page load
    local.remove(KEPT)
    restoring = Promise.resolve(null)
    fetch(KEEP, { method: 'DELETE', headers: HEADERS, keepalive: true }).catch(() => {})
  },
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  typeof window === 'undefined' ? undefined : { auth: { storage: durableStorage, persistSession: true, autoRefreshToken: true } },
)

// The signed-in user, read from the stored session. Unlike auth.getUser() this
// does not treat a network hiccup as "signed out": a failed token refresh is
// retried, so a weak connection does not bounce people to the sign-in page.
export async function getAuthedUser() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.auth.getSession()
    if (data.session) return data.session.user
    const retryable = !!error && (error.name === 'AuthRetryableFetchError' || (error as { status?: number }).status === 0)
    if (!retryable) return null
    await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)))
  }
  return null
}

// Sign out on this device only; other devices stay signed in
export const signOutHere = () => supabase.auth.signOut({ scope: 'local' })
