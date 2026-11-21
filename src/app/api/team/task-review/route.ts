import { NextRequest, NextResponse, after } from 'next/server'
import { notifyClientTaskReview } from '@/lib/clientNotify'

// Called by the admin and team boards right after a task is moved. If the
// task now sits in a client-review column, the project's clients get the
// "ready for your review" email. The request carries only the task id: the
// state is re-read on the server, and repeats within half an hour are ignored.

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })

  const origin = req.nextUrl.origin
  // Answer the board at once; the mail goes out after the response
  after(async () => {
    try {
      const r = await notifyClientTaskReview(taskId, origin)
      if (r.error) console.error('[task-review] mail failed:', r.error)
    } catch (e) {
      console.error('[task-review]', e)
    }
  })
  return NextResponse.json({ ok: true })
}
