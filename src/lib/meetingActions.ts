import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { todoColumnId } from '@/lib/estimateFlow'

// Action items from a project's calls. When a call recorded by Fellow lands
// on a project, the work the team took on during it is taken out as proposed
// cards. They are only proposals: the admin approves each one (it then
// becomes a normal To-Do task) or dismisses it.

const MODEL = process.env.PROJECT_AI_MODEL || process.env.LEAD_AI_MODEL || 'claude-opus-5'
// Calls older than this are not read automatically: their action items are
// long done or stale. They can still be read by hand from the call's card.
const AUTO_WINDOW_DAYS = 14

export const ACTIONS_MIGRATION_HINT = 'Запусти міграцію supabase/project_comms_migration.sql у Supabase SQL Editor'
const hint = (msg: string) => (/meeting_action_items|actions_extracted_at|schema cache/i.test(msg) ? ACTIONS_MIGRATION_HINT : msg)

export interface ActionItem {
  id: string
  meeting_id: string
  project_id: string
  title: string
  details: string | null
  owner: string | null
  due_date: string | null
  status: 'proposed' | 'approved' | 'dismissed'
  task_id: string | null
  created_at: string
  decided_at: string | null
}

interface Draft { title: string; details: string; owner: string; due_date: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Without an AI key: the bullets under Fellow's own "Action items" heading
export function actionsFromRecap(recap: string): Draft[] {
  const out: Draft[] = []
  let inside = false
  for (const line of recap.split('\n')) {
    const t = line.trim()
    if (/^#{2,3}\s/.test(t)) { inside = /action items?|next steps?|to-?dos?|наступні кроки|завдання|домовленост/i.test(t); continue }
    if (!inside || !t.startsWith('- ')) continue
    const text = t.slice(2).trim()
    if (text.length < 4) continue
    out.push({ title: text.slice(0, 160), details: text.length > 160 ? text : '', owner: '', due_date: null })
  }
  return out.slice(0, 15)
}

const EXTRACTOR = `You read one client call of Gudrix, a UX/UI design and development agency, recorded by the Fellow notetaker, and take out the action items for the agency's task board. You are given the call's notes and, when available, its transcript, plus the tasks already on the project's board.

Report every piece of work the Gudrix team committed to or was asked to do on this call: things to design, build, fix, prepare, send, check or decide. Each item becomes a card a designer or developer picks up, so it must stand on its own:
- title: an imperative task title of up to about 80 characters, naming the concrete thing ("Add CSV export to the inspections table"), never a vague theme ("Export").
- details: one to three sentences with what was agreed on the call: the specifics, constraints, numbers and the reason, so the person doing it does not need to listen to the recording.
- owner: the first name of the Gudrix person who took it on, when the call makes that clear; otherwise an empty string.
- due_date: YYYY-MM-DD only when a date or a clear deadline was stated ("by Friday" counts, resolved against the call date); otherwise null.

Leave out: things the client has to do themselves, small talk, ideas that were discussed and rejected or parked, and anything already covered by a task on the board. When one piece of work was mentioned several times, report it once. If the call produced no work for the team, return an empty list.

Write titles and details in the language of the tasks already on the board; when the board is empty, use the language the call was held in. Transcripts are automatic, so read obvious recognition errors by meaning. Do not invent work that was not discussed.`

async function draftWithAI(o: { title: string; date: string; recap: string; transcript: string; boardTasks: string[]; already: string[] }): Promise<Draft[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const material = [
    `# Call: ${o.title} (${o.date || 'date unknown'})`,
    o.recap ? `## Notes\n${o.recap.slice(0, 20_000)}` : '',
    o.transcript ? `## Transcript\n${o.transcript.slice(0, 150_000)}` : '',
    `## Tasks already on the board\n${o.boardTasks.length ? o.boardTasks.map(t => `- ${t}`).join('\n') : '(none)'}`,
    o.already.length ? `## Action items already taken from this project's calls (do not repeat)\n${o.already.map(t => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const msg = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: 8000,
      system: EXTRACTOR,
      tools: [{
        name: 'action_items',
        description: 'Report the action items for the Gudrix team from this call.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  details: { type: 'string' },
                  owner: { type: 'string' },
                  due_date: { type: ['string', 'null'] },
                },
                required: ['title', 'details', 'owner', 'due_date'],
              },
            },
          },
          required: ['items'],
        },
      }],
      tool_choice: { type: 'tool', name: 'action_items' },
      messages: [{ role: 'user', content: `<call_material>\n${material}\n</call_material>` }],
    })
    .finalMessage()
  const tu = msg.content.find(b => b.type === 'tool_use')
  const raw = (tu && tu.type === 'tool_use' ? (tu.input as { items?: unknown }).items : []) as Record<string, unknown>[]
  return (Array.isArray(raw) ? raw : [])
    .map(x => ({
      title: String(x?.title ?? '').trim().slice(0, 200),
      details: String(x?.details ?? '').trim().slice(0, 2000),
      owner: String(x?.owner ?? '').trim().slice(0, 60),
      due_date: isDate(x?.due_date) ? x.due_date : null,
    }))
    .filter(x => x.title.length >= 4)
    .slice(0, 20)
}

export interface ExtractResult { created: number; skipped?: string; source?: 'ai' | 'recap' }

export async function extractMeetingActions(meetingId: string, opts: { force?: boolean } = {}): Promise<ExtractResult> {
  const { data: meeting, error } = await supabaseAdmin.from('lead_meetings').select('*').eq('id', meetingId).maybeSingle()
  if (error) throw new Error(hint(error.message))
  const m = meeting as { id: string; title: string | null; started_at: string | null; recap: string | null; transcript: string | null; project_id?: string | null; actions_extracted_at?: string | null } | null
  if (!m) throw new Error('Дзвінок не знайдено')
  if (!m.project_id) return { created: 0, skipped: 'дзвінок не привʼязаний до проєкту' }
  const recap = (m.recap ?? '').trim(), transcript = (m.transcript ?? '').trim()
  if (!recap && !transcript) return { created: 0, skipped: 'Fellow ще не надіслав нотатки цього дзвінка' }
  if (m.actions_extracted_at && !opts.force) return { created: 0, skipped: 'вже опрацьовано' }

  const [{ data: existing, error: exErr }, { data: tasks }] = await Promise.all([
    // Everything already taken from this project's calls: the same piece of
    // work mentioned on two calls is proposed once
    supabaseAdmin.from('meeting_action_items').select('title').eq('project_id', m.project_id),
    supabaseAdmin.from('pm_tasks').select('title').eq('finance_project_id', m.project_id),
  ])
  if (exErr) throw new Error(hint(exErr.message))
  const already = (existing ?? []).map(e => String(e.title))
  const boardTasks = (tasks ?? []).map(t => String(t.title))

  let drafts: Draft[]
  let source: 'ai' | 'recap' = 'recap'
  if (process.env.ANTHROPIC_API_KEY) {
    drafts = await draftWithAI({ title: m.title ?? 'Зустріч', date: (m.started_at ?? '').slice(0, 10), recap, transcript, boardTasks, already })
    source = 'ai'
  } else {
    drafts = actionsFromRecap(recap)
  }

  // Never propose the same thing twice, nor what is already on the board
  const taken = new Set([...already, ...boardTasks].map(norm))
  const fresh: Draft[] = []
  for (const d of drafts) {
    const key = norm(d.title)
    if (!key || taken.has(key)) continue
    taken.add(key)
    fresh.push(d)
  }

  if (fresh.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('meeting_action_items').insert(fresh.map(d => ({
      meeting_id: m.id,
      project_id: m.project_id,
      title: d.title,
      details: d.details || null,
      owner: d.owner || null,
      due_date: d.due_date,
      status: 'proposed',
    })))
    if (insErr) throw new Error(hint(insErr.message))
  }
  await supabaseAdmin.from('lead_meetings').update({ actions_extracted_at: new Date().toISOString() }).eq('id', m.id)
  return { created: fresh.length, source }
}

// After a sync: read the recent project calls that have not been read yet
export async function extractPendingActions(limit = 4): Promise<{ meetings: number; created: number; error?: string }> {
  const since = new Date(Date.now() - AUTO_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('lead_meetings')
    .select('id, recap, transcript')
    .not('project_id', 'is', null)
    .is('actions_extracted_at', null)
    .eq('ignored', false)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) return { meetings: 0, created: 0, error: hint(error.message) }
  const ready = (data ?? []).filter(m => (m.recap ?? '').trim() || (m.transcript ?? '').trim()).slice(0, limit)
  let created = 0, meetings = 0, failed: string | undefined
  for (const m of ready) {
    try {
      const r = await extractMeetingActions(m.id as string)
      created += r.created
      meetings++
    } catch (e) {
      failed = (e as Error).message.slice(0, 200)
    }
  }
  return { meetings, created, ...(failed ? { error: failed } : {}) }
}

export async function listActions(projectId: string, onlyProposed = false): Promise<(ActionItem & { meeting_title: string; meeting_at: string | null })[]> {
  let q = supabaseAdmin.from('meeting_action_items').select('*').eq('project_id', projectId).order('created_at')
  if (onlyProposed) q = q.eq('status', 'proposed')
  const { data, error } = await q
  if (error) throw new Error(hint(error.message))
  const items = (data ?? []) as ActionItem[]
  const ids = [...new Set(items.map(i => i.meeting_id))]
  const { data: meetings } = ids.length
    ? await supabaseAdmin.from('lead_meetings').select('id, title, started_at').in('id', ids)
    : { data: [] as { id: string; title: string | null; started_at: string | null }[] }
  const byId = new Map((meetings ?? []).map(m => [m.id as string, m]))
  return items.map(i => ({
    ...i,
    meeting_title: String(byId.get(i.meeting_id)?.title ?? 'Зустріч'),
    meeting_at: (byId.get(i.meeting_id)?.started_at as string | null) ?? null,
  }))
}

// Approve → a real task in To-Do. Dismiss → gone from the list. Restore →
// back to proposed (only while no task was made from it).
export async function decideAction(
  id: string,
  decision: 'approve' | 'dismiss' | 'restore',
  edits: { title?: string; details?: string } = {},
): Promise<{ item: ActionItem; task?: Record<string, unknown> } | { error: string; status: number }> {
  const { data, error } = await supabaseAdmin.from('meeting_action_items').select('*').eq('id', id).maybeSingle()
  if (error) return { error: hint(error.message), status: 400 }
  const item = data as ActionItem | null
  if (!item) return { error: 'Action item не знайдено', status: 404 }
  const now = new Date().toISOString()

  if (decision === 'dismiss' || decision === 'restore') {
    if (item.status === 'approved') return { error: 'З цього пункту вже створено задачу', status: 409 }
    const status = decision === 'dismiss' ? 'dismissed' : 'proposed'
    await supabaseAdmin.from('meeting_action_items').update({ status, decided_at: decision === 'dismiss' ? now : null }).eq('id', id)
    return { item: { ...item, status, decided_at: decision === 'dismiss' ? now : null } }
  }

  // Approving twice must not make two tasks
  if (item.status === 'approved') return { error: 'Вже апрувнуто', status: 409 }
  const title = (edits.title ?? item.title).trim().slice(0, 200)
  if (!title) return { error: 'Назва задачі порожня', status: 400 }
  const details = (edits.details ?? item.details ?? '').trim()

  const { data: meeting } = await supabaseAdmin.from('lead_meetings').select('title, started_at').eq('id', item.meeting_id).maybeSingle()
  const when = meeting?.started_at ? new Date(meeting.started_at as string).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const origin = `Action item з дзвінка «${meeting?.title ?? 'Зустріч'}»${when ? ` (${when})` : ''}${item.owner ? ` · взяв: ${item.owner}` : ''}`

  const columnId = await todoColumnId(item.project_id)
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('pm_tasks')
    .insert({
      finance_project_id: item.project_id,
      column_id: columnId,
      title,
      description: [details, origin].filter(Boolean).join('\n\n'),
      status: 'todo',
      priority: 'medium',
      due_date: item.due_date,
    })
    .select()
    .single()
  if (taskErr || !task) return { error: taskErr?.message ?? 'Не вдалося створити задачу', status: 400 }

  await supabaseAdmin
    .from('meeting_action_items')
    .update({ status: 'approved', task_id: task.id, title, details: details || null, decided_at: now })
    .eq('id', id)
  return { item: { ...item, status: 'approved', task_id: task.id as string, title, details: details || null, decided_at: now }, task }
}
