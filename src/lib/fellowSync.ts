import supabaseAdmin from '@/lib/supabaseAdmin'
import {
  FellowNote, FellowRecording, getMe, getNote, listNotes, listRecordings, recapText, speakerNames, transcriptText,
} from '@/lib/fellow'
import { generateLeadOverview } from '@/lib/leadInsight'
import { generateProjectReview } from '@/lib/projectInsight'

// Pull recordings from Fellow into lead_meetings and attach each one to the
// CRM lead it belongs to. Meetings nobody could be matched to stay unassigned
// for the admin to sort by hand.

const STATE_KEY = 'fellow'
const FIRST_SYNC_DAYS = 120
const OVERLAP_MS = 2 * 86_400_000 // re-read a window: recaps arrive after the recording
const MAX_ANALYSES_PER_RUN = 6

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'ukr.net', 'i.ua', 'meta.ua', 'aol.com', 'gmx.com', 'mail.com', 'yandex.com',
])

export interface FellowState {
  last_synced_at?: string
  last_error?: string | null
  running_since?: string | null
  own_email?: string
  webhook_id?: string
  webhook_secret?: string
}

export interface SyncResult {
  imported: number
  matched: number
  unmatched: number
  analyzed: number
  skipped?: 'running'
}

interface LeadRow { id: string; name: string; email: string | null; status: string; created_at: string }

export async function getFellowState(): Promise<FellowState> {
  const { data } = await supabaseAdmin.from('integration_state').select('value').eq('key', STATE_KEY).maybeSingle()
  return (data?.value ?? {}) as FellowState
}

export async function patchFellowState(patch: Partial<FellowState>) {
  const cur = await getFellowState()
  const { error } = await supabaseAdmin
    .from('integration_state')
    .upsert({ key: STATE_KEY, value: { ...cur, ...patch }, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

const emailsOf = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []
const domainOf = (email: string) => email.split('@')[1] ?? ''
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function matchLead(
  leads: LeadRow[],
  m: { title: string; external: string[]; speakers: string[] },
): { lead: LeadRow; reason: 'email' | 'domain' | 'name' } | null {
  // Open deals first, then the newest: a returning client matches the live deal
  const ranked = [...leads].sort((a, b) => {
    const open = (l: LeadRow) => (l.status === 'won' || l.status === 'lost' ? 1 : 0)
    return open(a) - open(b) || b.created_at.localeCompare(a.created_at)
  })
  const ext = new Set(m.external)
  const extDomains = new Set(m.external.map(domainOf).filter(d => d && !FREE_MAIL.has(d)))

  for (const l of ranked) if (emailsOf(l.email).some(e => ext.has(e))) return { lead: l, reason: 'email' }
  for (const l of ranked) {
    if (emailsOf(l.email).some(e => extDomains.has(domainOf(e)))) return { lead: l, reason: 'domain' }
  }
  const title = ` ${norm(m.title)} `
  const speakers = m.speakers.map(norm)
  for (const l of ranked) {
    const name = norm(l.name)
    if (name.length < 4) continue
    if (title.includes(` ${name} `)) return { lead: l, reason: 'name' }
    if (speakers.some(s => s === name || (s.includes(' ') && name.includes(s)))) return { lead: l, reason: 'name' }
  }
  return null
}

// Attach calls to client projects: through the lead that became the project,
// through a client account's email among the attendees, or by the project's
// name in the call title (which also catches internal calls about a project).
// Returns the projects that gained calls. Throws when the project_id column
// is not migrated yet — the caller treats that as "nothing to link".
export async function linkMeetingsToProjects(isInternal: (email: string) => boolean): Promise<string[]> {
  const { data: meetings, error } = await supabaseAdmin
    .from('lead_meetings')
    .select('id, title, attendees, lead_id, ignored')
    .is('project_id', null)
  if (error) throw new Error(error.message)
  if (!meetings || meetings.length === 0) return []

  const [{ data: projects }, { data: links }, { data: leads }] = await Promise.all([
    supabaseAdmin.from('projects').select('id, name, status, created_at').neq('status', 'archived'),
    supabaseAdmin.from('project_clients').select('project_id, clients(email)'),
    supabaseAdmin.from('crm_leads').select('id, project_id').not('project_id', 'is', null),
  ])
  const active = new Set((projects ?? []).map(p => p.id))
  const byLead = new Map((leads ?? []).map(l => [l.id as string, l.project_id as string]))
  const byClientEmail = new Map<string, string>()
  for (const l of (links ?? []) as unknown as { project_id: string; clients: { email: string | null } | null }[]) {
    const e = (l.clients?.email ?? '').trim().toLowerCase()
    if (e && active.has(l.project_id)) byClientEmail.set(e, l.project_id)
  }
  const names = (projects ?? [])
    .map(p => ({ id: p.id as string, name: norm(p.name as string) }))
    .filter(p => p.name.length >= 4)
    .sort((a, b) => b.name.length - a.name.length)

  const touched = new Set<string>()
  for (const m of meetings) {
    const external = ((m.attendees ?? []) as string[]).filter(e => !isInternal(e))
    const title = ` ${norm(m.title ?? '')} `
    const projectId =
      (m.lead_id && byLead.get(m.lead_id)) ||
      external.map(e => byClientEmail.get(e)).find(Boolean) ||
      names.find(p => title.includes(` ${p.name} `))?.id
    if (!projectId || !active.has(projectId)) continue
    if (m.ignored && !(m.lead_id || names.some(p => p.id === projectId && title.includes(` ${p.name} `)))) continue
    await supabaseAdmin.from('lead_meetings').update({ project_id: projectId, ignored: false }).eq('id', m.id)
    touched.add(projectId)
  }
  return [...touched]
}

export async function syncFellow(): Promise<SyncResult> {
  const state = await getFellowState()
  // A sync started under 4 minutes ago is still running (or just crashed)
  if (state.running_since && Date.now() - new Date(state.running_since).getTime() < 240_000) {
    return { imported: 0, matched: 0, unmatched: 0, analyzed: 0, skipped: 'running' }
  }
  const startedAt = new Date()
  await patchFellowState({ running_since: startedAt.toISOString() })

  try {
    const since = new Date(
      state.last_synced_at
        ? new Date(state.last_synced_at).getTime() - OVERLAP_MS
        : Date.now() - FIRST_SYNC_DAYS * 86_400_000,
    ).toISOString()

    let ownEmail = state.own_email ?? ''
    if (!ownEmail) ownEmail = ((await getMe()).user?.email ?? '').toLowerCase()

    const [recordings, notes] = await Promise.all([listRecordings(since), listNotes(since)])
    const noteById = new Map<string, FellowNote>(notes.map(n => [n.id, n]))

    const [{ data: leadRows }, { data: existingRows, error: exErr }] = await Promise.all([
      supabaseAdmin.from('crm_leads').select('id, name, email, status, created_at'),
      supabaseAdmin.from('lead_meetings').select('id, external_id, lead_id, ignored, recap, transcript').eq('source', 'fellow'),
    ])
    if (exErr) throw new Error(exErr.message)
    const leads = (leadRows ?? []) as LeadRow[]
    const existing = new Map((existingRows ?? []).map(r => [r.external_id as string, r]))

    const ownDomain = domainOf(ownEmail)
    const isInternal = (e: string) =>
      e === ownEmail || (!!ownDomain && !FREE_MAIL.has(ownDomain) && domainOf(e) === ownDomain)

    const result: SyncResult = { imported: 0, matched: 0, unmatched: 0, analyzed: 0 }
    const touchedLeads = new Set<string>()

    for (const rec of recordings as FellowRecording[]) {
      const transcript = transcriptText(rec)
      const recap = recapText(rec)
      if (!transcript && !recap) continue // still processing in Fellow; picked up next run

      let note = rec.note_id ? noteById.get(rec.note_id) ?? null : null
      const prev = existing.get(rec.id)
      if (!note && rec.note_id && !prev) note = await getNote(rec.note_id).catch(() => null)

      const attendees = [...new Set(
        [...(note?.event_attendees ?? []).map(a => a.email ?? ''), note?.organizer_email ?? '']
          .map(e => e.trim().toLowerCase())
          .filter(Boolean),
      )]
      const row = {
        source: 'fellow',
        external_id: rec.id,
        note_id: rec.note_id ?? null,
        title: (rec.title ?? note?.title ?? '').trim() || 'Зустріч',
        started_at: rec.started_at ?? rec.created_at ?? null,
        ended_at: rec.ended_at ?? null,
        recap: recap || null,
        transcript: transcript || null,
        updated_at: new Date().toISOString(),
      }

      if (prev) {
        const changed = (prev.recap ?? '') !== (recap || '') || (prev.transcript ?? '') !== (transcript || '')
        if (!changed) continue
        // Keep the lead / ignored choice and the attendee list already stored
        const { error } = await supabaseAdmin
          .from('lead_meetings')
          .update({ ...row, ...(attendees.length > 0 ? { attendees } : {}) })
          .eq('id', prev.id)
        if (error) throw new Error(error.message)
        if (prev.lead_id) touchedLeads.add(prev.lead_id)
        continue
      }

      const external = attendees.filter(e => !isInternal(e))
      const hit = matchLead(leads, { title: row.title, external, speakers: speakerNames(rec) })
      const { error } = await supabaseAdmin.from('lead_meetings').insert({
        ...row,
        attendees,
        lead_id: hit?.lead.id ?? null,
        match_reason: hit?.reason ?? null,
        // Only our own people on the invite → an internal meeting, not a deal
        ignored: !hit && attendees.length > 0 && external.length === 0,
      })
      if (error) throw new Error(error.message)
      result.imported++
      if (hit) { result.matched++; touchedLeads.add(hit.lead.id) } else result.unmatched++
    }

    // A lead added (or given an email) since the last run may now claim a
    // call that was left unassigned
    const { data: orphans } = await supabaseAdmin
      .from('lead_meetings')
      .select('id, title, attendees')
      .is('lead_id', null)
      .eq('ignored', false)
    for (const o of orphans ?? []) {
      const external = ((o.attendees ?? []) as string[]).filter(e => !isInternal(e))
      const hit = matchLead(leads, { title: o.title, external, speakers: [] })
      if (!hit) continue
      await supabaseAdmin.from('lead_meetings').update({ lead_id: hit.lead.id, match_reason: hit.reason }).eq('id', o.id)
      result.matched++
      result.unmatched = Math.max(0, result.unmatched - 1)
      touchedLeads.add(hit.lead.id)
    }

    const touchedProjects = await linkMeetingsToProjects(isInternal).catch(() => [] as string[])

    await patchFellowState({
      last_synced_at: startedAt.toISOString(),
      last_error: null,
      running_since: null,
      own_email: ownEmail,
    })

    // New call content changes the picture of the deal → refresh its overview
    const done = await Promise.allSettled([...touchedLeads].slice(0, MAX_ANALYSES_PER_RUN).map(id => generateLeadOverview(id)))
    result.analyzed = done.filter(d => d.status === 'fulfilled').length
    // A project that gained a call gets its review refreshed too
    await Promise.allSettled(touchedProjects.slice(0, 3).map(id => generateProjectReview(id)))
    return result
  } catch (e) {
    await patchFellowState({ last_error: (e as Error).message.slice(0, 300), running_since: null }).catch(() => {})
    throw e
  }
}
