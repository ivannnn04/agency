import { NextRequest, NextResponse } from 'next/server'

// Keeps team members and clients signed in until they sign out themselves.
//
// Their Supabase session lives in the browser's localStorage, which some
// browsers wipe on their own (Safari clears it after a week without a visit).
// The browser therefore also leaves the session's refresh token here, in a
// long-lived cookie that only this route can read. When the local session is
// gone, GET trades that token for a fresh session.

export const dynamic = 'force-dynamic'

const COOKIE = 'gx_keep'
const PATH = '/api/portal/keep-session'
// Browsers cap cookie lifetime at about 400 days; every visit renews it
const MAX_AGE = 400 * 24 * 60 * 60
const options = (maxAge = MAX_AGE) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: PATH,
  maxAge,
})

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Only our own pages may talk to this route
function ownPage(req: NextRequest) {
  if (req.headers.get('x-gudrix-session') !== '1') return false
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const host = new URL(origin).host
    return host === req.headers.get('host') || host === req.headers.get('x-forwarded-host')
  } catch {
    return false
  }
}

// Remember the current refresh token
export async function POST(req: NextRequest) {
  if (!ownPage(req)) return json({ error: 'Forbidden' }, 403)
  const body = await req.json().catch(() => null) as { refresh_token?: unknown } | null
  const token = typeof body?.refresh_token === 'string' ? body.refresh_token : ''
  if (!/^[\w.-]{6,512}$/.test(token)) return json({ error: 'Bad token' }, 400)
  const res = json({ ok: true })
  res.cookies.set(COOKIE, token, options())
  return res
}

// The local session is gone: trade the remembered token for a fresh session
export async function GET(req: NextRequest) {
  if (!ownPage(req)) return json({ error: 'Forbidden' }, 403)
  const token = req.cookies.get(COOKIE)?.value
  if (!token) return json({ session: null })
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
      cache: 'no-store',
    })
    if (r.ok) {
      const session = await r.json()
      if (session?.access_token && session?.refresh_token) {
        if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600)
        const res = json({ session })
        res.cookies.set(COOKIE, session.refresh_token, options())
        return res
      }
    } else if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      // The token was revoked (signed out, or replaced long ago): forget it
      const res = json({ session: null })
      res.cookies.set(COOKIE, '', options(0))
      return res
    }
  } catch {
    // Supabase unreachable right now: keep the token for the next visit
  }
  return json({ session: null })
}

// Signed out by hand: forget the token
export async function DELETE(req: NextRequest) {
  if (!ownPage(req)) return json({ error: 'Forbidden' }, 403)
  const res = json({ ok: true })
  res.cookies.set(COOKIE, '', options(0))
  return res
}
