import { NextRequest, NextResponse, after } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { fellowConfig } from '@/lib/fellow'
import { getFellowState, syncFellow } from '@/lib/fellowSync'

// Public endpoint Fellow calls when AI notes for a meeting are ready. The
// payload itself is never trusted or stored: a valid delivery only triggers
// a pull through the API with our own key.

export const maxDuration = 300

function validSignature(secret: string, id: string, ts: string, body: string, header: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest()
  return header.split(' ').some(part => {
    const sig = Buffer.from(part.split(',')[1] ?? '', 'base64')
    return sig.length === expected.length && timingSafeEqual(sig, expected)
  })
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  let payload: { type?: string; challenge?: string; event_type?: string } = {}
  try { payload = JSON.parse(raw) } catch { return new NextResponse('bad request', { status: 400 }) }

  // Registration handshake: echo the challenge back as plain text
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
    return new NextResponse(payload.challenge.slice(0, 200), { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  if (!fellowConfig()) return new NextResponse('not configured', { status: 200 })

  const state = await getFellowState().catch(() => null)
  if (!state?.webhook_secret) return new NextResponse('no webhook registered', { status: 401 })
  const ok = validSignature(
    state.webhook_secret,
    req.headers.get('svix-id') ?? '',
    req.headers.get('svix-timestamp') ?? '',
    raw,
    req.headers.get('svix-signature') ?? '',
  )
  if (!ok) return new NextResponse('bad signature', { status: 401 })

  if (payload.event_type === 'ai_note.generated') {
    after(async () => { await syncFellow().catch(() => {}) })
  }
  return new NextResponse('ok', { status: 200 })
}
