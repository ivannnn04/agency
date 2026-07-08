import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Runs daily at 13:00 UTC (16:00 Kyiv in summer) via Vercel Cron.
// Finds tasks due TOMORROW and notifies the assigned designer + admin.

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function kyivDateStr(offsetDays: number): string {
  const now = new Date()
  const kyivNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }))
  kyivNow.setDate(kyivNow.getDate() + offsetDays)
  const y = kyivNow.getFullYear()
  const m = String(kyivNow.getMonth() + 1).padStart(2, '0')
  const d = String(kyivNow.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function GET(req: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when the env var is set
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = adminClient()

  const tomorrow = kyivDateStr(1)
  const dayAfter = kyivDateStr(2)

  // due_date may be stored as date or timestamp — use a range to be safe
  const { data: tasks, error } = await admin
    .from('pm_tasks')
    .select('id, title, due_date, team_member_id, finance_project_id')
    .gte('due_date', tomorrow)
    .lt('due_date', dayAfter)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!tasks || tasks.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  // Skip tasks that already got a reminder (idempotent re-runs)
  const taskIds = tasks.map(t => t.id)
  const { data: existing } = await admin
    .from('notifications')
    .select('task_id')
    .eq('type', 'deadline_reminder')
    .in('task_id', taskIds)
  const alreadySent = new Set((existing ?? []).map(n => n.task_id))
  const pending = tasks.filter(t => !alreadySent.has(t.id))

  if (pending.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const projIds  = [...new Set(pending.map(t => t.finance_project_id).filter(Boolean))]
  const memIds   = [...new Set(pending.map(t => t.team_member_id).filter(Boolean))]

  const [{ data: projs }, { data: mems }] = await Promise.all([
    projIds.length > 0
      ? admin.from('projects').select('id, name').in('id', projIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    memIds.length > 0
      ? admin.from('team_members').select('id, name').in('id', memIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const projMap = new Map((projs ?? []).map(p => [p.id, p.name]))
  const memMap  = new Map((mems ?? []).map(m => [m.id, m.name]))

  const rows = pending.flatMap(t => {
    const projName = t.finance_project_id ? projMap.get(t.finance_project_id) ?? '' : ''
    const memName  = t.team_member_id ? memMap.get(t.team_member_id) ?? '' : ''
    const base = {
      type: 'deadline_reminder',
      project_id: t.finance_project_id,
      task_id: t.id,
      team_member_id: t.team_member_id,
    }
    const result = [
      // Admin notification (recipient null → shows in admin bell)
      {
        ...base,
        message: `⏰ Завтра дедлайн задачі «${t.title}»${projName ? ` у проєкті «${projName}»` : ''}${memName ? ` (виконавець: ${memName})` : ''}`,
        recipient_team_member_id: null,
      },
    ]
    // Designer notification, if the task is assigned
    if (t.team_member_id) {
      result.push({
        ...base,
        message: `⏰ Завтра дедлайн! Задачу «${t.title}»${projName ? ` у проєкті «${projName}»` : ''} потрібно завершити до завтра`,
        recipient_team_member_id: t.team_member_id,
      })
    }
    return result
  })

  const { error: insErr } = await admin.from('notifications').insert(rows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, sent: rows.length, tasks: pending.length })
}
