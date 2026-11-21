import { NextRequest, NextResponse } from 'next/server'
import { sendEstimate } from '@/lib/estimateFlow'

// "Send the estimate to the client" on the admin and team boards. The board
// has already saved hours / cost / note on the task; here the task is
// re-read, marked as sent and the project's clients are emailed.

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })

  const r = await sendEstimate(taskId, req.nextUrl.origin)
  if (!r.ok) {
    const migration = /estimate_|schema cache/i.test(r.error ?? '')
    return NextResponse.json({
      error: migration ? 'Запусти міграцію supabase/estimate_flow_migration.sql у Supabase SQL Editor' : r.error,
    }, { status: 400 })
  }
  return NextResponse.json({ ok: true, sent: r.sent ?? 0, mailError: r.error ?? null })
}
