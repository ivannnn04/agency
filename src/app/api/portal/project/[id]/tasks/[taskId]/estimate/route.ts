import { NextRequest, NextResponse } from 'next/server'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'
import { decideEstimate } from '@/lib/estimateFlow'

// The client's answer to an estimate: approve it (the task goes to To-Do)
// or leave a comment (the team revises and sends it again).

export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, taskId } = await params
  if (!await clientHasProject(client.id, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const action = body?.action === 'approve' ? 'approve' : body?.action === 'comment' ? 'comment' : null
  if (!action) return NextResponse.json({ error: 'action must be approve or comment' }, { status: 400 })

  const r = await decideEstimate({
    taskId,
    projectId: id,
    clientName: client.name || client.email,
    action,
    comment: typeof body?.comment === 'string' ? body.comment : '',
    origin: req.nextUrl.origin,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 })
  return NextResponse.json({ ok: true })
}
