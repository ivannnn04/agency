import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { decideAction, listActions } from '@/lib/meetingActions'

// Action items taken from a project's calls, waiting for the admin.
// GET   ?project=                         the proposed ones (for the board)
// PATCH { id, decision, title?, details? } approve → a To-Do task; dismiss; restore

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project')
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })
  try {
    return NextResponse.json({ items: await listActions(projectId, true) })
  } catch (e) {
    // Before the migration the board simply has no such column
    return NextResponse.json({ items: [], error: (e as Error).message })
  }
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { id?: string; decision?: string; title?: string; details?: string } | null
  const decision = body?.decision
  if (typeof body?.id !== 'string' || (decision !== 'approve' && decision !== 'dismiss' && decision !== 'restore')) {
    return NextResponse.json({ error: 'id and decision are required' }, { status: 400 })
  }
  const r = await decideAction(body.id, decision, {
    title: typeof body.title === 'string' ? body.title : undefined,
    details: typeof body.details === 'string' ? body.details : undefined,
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
