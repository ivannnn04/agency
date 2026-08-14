import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// Runs every morning via Vercel Cron. For each active project that has portal
// clients, Gudrix AI reads the last day of task activity + chat and drafts a
// client update. The draft lands in daily_digests as 'pending' — the admin
// reviews it in the team chat (Редагувати / Апрув) before it reaches the client.

export const maxDuration = 300

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface Task {
  id: string
  title: string
  column_id: string | null
  priority: string | null
  due_date: string | null
  created_at: string
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }

  const admin = adminClient()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const today = new Date().toISOString().slice(0, 10)
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  // Only projects a client can actually see get a digest
  const { data: links, error: linkErr } = await admin
    .from('project_clients')
    .select('project_id')
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })

  const projectIds = [...new Set((links ?? []).map(l => l.project_id))]
  if (projectIds.length === 0) return NextResponse.json({ ok: true, drafted: 0 })

  const { data: projects } = await admin
    .from('projects')
    .select('id, name, status')
    .in('id', projectIds)
    .eq('status', 'active')

  let drafted = 0
  const skipped: string[] = []

  for (const project of projects ?? []) {
    // One pending draft per project per day — re-runs stay idempotent
    const { data: existing } = await admin
      .from('daily_digests')
      .select('id')
      .eq('project_id', project.id)
      .gte('created_at', `${today}T00:00:00Z`)
      .limit(1)
    if (existing && existing.length > 0) { skipped.push(project.name); continue }

    const [{ data: columns }, { data: tasks }] = await Promise.all([
      admin.from('pm_columns').select('id, name, position').eq('project_id', project.id).order('position'),
      admin.from('pm_tasks')
        .select('id, title, column_id, priority, due_date, created_at')
        .eq('finance_project_id', project.id)
        .order('created_at'),
    ])
    const taskList = (tasks ?? []) as Task[]
    if (taskList.length === 0) { skipped.push(project.name); continue }

    const colName = new Map((columns ?? []).map(c => [c.id, c.name as string]))
    const taskIds = taskList.map(t => t.id)

    // Last-24h signals: tracked work, chat, change requests, new tasks
    const [{ data: recentTime }, { data: recentMsgs }, { data: recentCRs }] = await Promise.all([
      admin.from('time_entries')
        .select('task_id, duration_seconds, ended_at')
        .in('task_id', taskIds)
        .not('ended_at', 'is', null)
        .gte('ended_at', since),
      admin.from('project_messages')
        .select('channel, sender_type, sender_name, content, created_at')
        .eq('project_id', project.id)
        .gte('created_at', since)
        .neq('sender_type', 'bot')
        .order('created_at')
        .limit(100),
      admin.from('change_requests')
        .select('task_id, client_name, content, status, created_at')
        .eq('project_id', project.id)
        .gte('created_at', since),
    ])

    const newTasks = taskList.filter(t => t.created_at >= since)
    const upcoming = taskList.filter(t => t.due_date && t.due_date >= today && t.due_date <= weekAhead)
    const hasActivity =
      (recentTime?.length ?? 0) > 0 ||
      (recentMsgs?.length ?? 0) > 0 ||
      (recentCRs?.length ?? 0) > 0 ||
      newTasks.length > 0

    // Dormant project with nothing due soon → no digest, no noise
    if (!hasActivity && upcoming.length === 0) { skipped.push(project.name); continue }

    const workedTaskIds = new Set((recentTime ?? []).map(e => e.task_id))
    const workedTasks = taskList.filter(t => workedTaskIds.has(t.id))

    const board = taskList
      .map(t => `- "${t.title}" — column: ${colName.get(t.column_id ?? '') ?? '—'}${t.priority ? `, priority: ${t.priority}` : ''}${t.due_date ? `, due: ${t.due_date}` : ''}`)
      .join('\n')
    const worked = workedTasks.length > 0
      ? workedTasks.map(t => `- "${t.title}"`).join('\n')
      : '(no tracked time in the last 24h)'
    const chat = (recentMsgs ?? [])
      .map(m => `[${m.channel}] ${m.sender_name} (${m.sender_type}): ${String(m.content).slice(0, 300)}`)
      .join('\n') || '(no messages in the last 24h)'
    const crs = (recentCRs ?? [])
      .map(c => `- from ${c.client_name ?? 'client'}: ${String(c.content).slice(0, 200)} [${c.status}]`)
      .join('\n') || '(none)'

    const prompt = `You are "Gudrix AI", the assistant of the Gudrix design agency. Draft a short morning status update for the CLIENT of the project "${project.name}".

Data from the last 24 hours:

CURRENT BOARD (all tasks with their column):
${board}

TASKS THE TEAM TRACKED TIME ON (last 24h):
${worked}

NEW TASKS CREATED (last 24h):
${newTasks.map(t => `- "${t.title}"`).join('\n') || '(none)'}

CHAT MESSAGES (last 24h; [team] = internal, [client] = with the client):
${chat}

CLIENT CHANGE REQUESTS (last 24h):
${crs}

TASKS DUE IN THE NEXT 7 DAYS:
${upcoming.map(t => `- "${t.title}" — due ${t.due_date}`).join('\n') || '(none)'}

Rules:
- Write in English, warm but professional, 60–120 words.
- Structure: one-line greeting, "What we worked on" and "What's next" (short bullet lists), closing line.
- NEVER reveal internal details: no tracked hours, no rates or money, no internal team chat quotes, no team disagreements. Internal chat is context for you only.
- Mention client change requests only to confirm they were received / are in progress.
- If there was little visible activity, focus on what is planned next — never apologize or say "no work was done".
- Output ONLY the message text, no preamble, no subject line, no markdown headers (plain text with simple "•" bullets is fine).`

    try {
      const res = await anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      })
      const draft = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim()
      if (!draft) { skipped.push(project.name); continue }

      const { error: insErr } = await admin
        .from('daily_digests')
        .insert({ project_id: project.id, draft, status: 'pending' })
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
      drafted++
    } catch (e) {
      // One failing project must not kill the whole run
      console.error(`digest failed for ${project.name}:`, e)
      skipped.push(project.name)
    }
  }

  return NextResponse.json({ ok: true, drafted, skipped })
}
