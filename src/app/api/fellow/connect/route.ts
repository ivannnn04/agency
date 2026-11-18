import { NextRequest, NextResponse } from 'next/server'
import { fellowFetch, getMe } from '@/lib/fellow'
import { getFellowState, patchFellowState } from '@/lib/fellowSync'

// Instant sync: register a Fellow webhook that pings /api/fellow/webhook as
// soon as AI notes for a meeting are ready. Admin-only via the middleware.

export async function GET() {
  try {
    const me = await getMe()
    return NextResponse.json({ ok: true, user: me.user?.email ?? null, workspace: me.workspace?.name ?? null })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const state = await getFellowState()
  if (state.webhook_id) return NextResponse.json({ ok: true, already: true })
  const url = `${req.nextUrl.origin}/api/fellow/webhook`
  try {
    const res = await fellowFetch<{ webhook?: { id?: string; secret?: string } }>('/webhook', {
      method: 'POST',
      body: { url, enabled_events: ['ai_note.generated'], description: 'Gudrix CRM — sync calls to leads', status: 'active' },
    })
    if (!res.webhook?.id) throw new Error('Fellow не повернув webhook')
    await patchFellowState({ webhook_id: res.webhook.id, webhook_secret: res.webhook.secret })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.json({
      error: /403|not enabled|disabled|permission/i.test(msg)
        ? 'Fellow відхилив вебхук. Увімкни «Allow users to create webhooks» у Workspace settings → Developer і спробуй ще раз.'
        : msg.slice(0, 300),
    }, { status: 502 })
  }
}

export async function DELETE() {
  const state = await getFellowState()
  if (state.webhook_id) {
    await fellowFetch(`/webhook/${encodeURIComponent(state.webhook_id)}`, { method: 'DELETE' }).catch(() => {})
    await patchFellowState({ webhook_id: undefined, webhook_secret: undefined })
  }
  return NextResponse.json({ ok: true })
}
