// Thin client for Fellow's Developer API (https://developers.fellow.ai).
// Auth is a per-user API key; it sees exactly what its owner sees in Fellow.

export interface FellowSegment { speaker?: string | null; text?: string | null }
export interface FellowRecording {
  id: string
  title?: string | null
  started_at?: string | null
  ended_at?: string | null
  created_at?: string | null
  note_id?: string | null
  transcript?: { speech_segments?: FellowSegment[] | null } | null
  ai_notes?: unknown[] | null
}
export interface FellowNote {
  id: string
  title?: string | null
  recording_ids?: string[] | null
  event_attendees?: { email?: string | null }[] | null
  organizer_email?: string | null
}

export function fellowConfig(): { base: string; key: string } | null {
  const key = (process.env.FELLOW_API_KEY ?? '').trim()
  // Accept "gudrix", "gudrix.fellow.app" or a full URL
  const sub = (process.env.FELLOW_SUBDOMAIN ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.fellow\.app.*$/, '')
    .replace(/[^a-z0-9-]/gi, '')
  if (!key || !sub) return null
  return { base: `https://${sub}.fellow.app/api/v1`, key }
}

export class FellowError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function fellowFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const cfg = fellowConfig()
  if (!cfg) throw new FellowError(0, 'FELLOW_API_KEY / FELLOW_SUBDOMAIN не налаштовані')
  // The API allows 3 requests per second per key; back off on 429
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(cfg.base + path, {
      method: init?.method ?? 'GET',
      headers: { 'X-API-KEY': cfg.key, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    })
    if (res.status === 429 && attempt < 4) { await sleep(1200 * (attempt + 1)); continue }
    const text = await res.text()
    if (!res.ok) {
      const hint = res.status === 401 ? ' (перевір FELLOW_API_KEY)' : res.status === 404 ? ' (перевір FELLOW_SUBDOMAIN)' : ''
      throw new FellowError(res.status, `Fellow ${res.status}${hint}: ${text.slice(0, 200)}`)
    }
    try { return JSON.parse(text) as T } catch { throw new FellowError(res.status, 'Fellow повернув не JSON') }
  }
}

async function listAll<T>(path: string, key: 'recordings' | 'notes', body: Record<string, unknown>, pageSize: number, maxItems: number): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  do {
    const page: Record<string, { page_info?: { cursor?: string | null }; data?: T[] }> = await fellowFetch(path, {
      method: 'POST',
      body: { ...body, pagination: { cursor, page_size: pageSize } },
    })
    out.push(...(page[key]?.data ?? []))
    cursor = page[key]?.page_info?.cursor ?? null
  } while (cursor && out.length < maxItems)
  return out
}

export const listRecordings = (sinceIso: string) =>
  listAll<FellowRecording>('/recordings', 'recordings', {
    include: { transcript: true, ai_notes: true },
    filters: { updated_at_start: sinceIso },
  }, 10, 400)

export const listNotes = (sinceIso: string) =>
  listAll<FellowNote>('/notes', 'notes', {
    include: { event_attendees: true, organizer_email: true },
    filters: { updated_at_start: sinceIso },
  }, 50, 1500)

export const getNote = (id: string) =>
  fellowFetch<{ note?: FellowNote }>(`/note/${encodeURIComponent(id)}`).then(r => r.note ?? null)

export const getMe = () =>
  fellowFetch<{ user?: { email?: string; full_name?: string }; workspace?: { name?: string; subdomain?: string } }>('/me')

// "Speaker: text" lines, consecutive segments of one speaker merged
export function transcriptText(rec: FellowRecording): string {
  const lines: string[] = []
  let last = ''
  for (const s of rec.transcript?.speech_segments ?? []) {
    const text = (s.text ?? '').trim()
    if (!text) continue
    const speaker = (s.speaker ?? '').trim() || 'Speaker'
    if (speaker === last && lines.length > 0) lines[lines.length - 1] += ' ' + text
    else { lines.push(`${speaker}: ${text}`); last = speaker }
  }
  return lines.join('\n')
}

export function speakerNames(rec: FellowRecording): string[] {
  const set = new Set<string>()
  for (const s of rec.transcript?.speech_segments ?? []) {
    const n = (s.speaker ?? '').trim()
    if (n) set.add(n)
  }
  return [...set]
}

// Fellow's AI recap is a tree of templates → sections → topics/bullets/action
// items/decisions. Flatten whatever shape arrives into readable text.
export function recapText(rec: FellowRecording): string {
  const out: string[] = []
  const walk = (node: unknown, depth: number) => {
    if (node == null) return
    if (typeof node === 'string') { if (node.trim()) out.push(node.trim()); return }
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth)); return }
    if (typeof node !== 'object') return
    const o = node as Record<string, unknown>
    if (typeof o.title === 'string' && o.title.trim()) out.push(`${depth === 0 ? '## ' : '### '}${o.title.trim()}`)
    if (typeof o.text === 'string' && o.text.trim()) out.push(`- ${o.text.trim()}`)
    for (const k of ['sections', 'content', 'bullet_points']) if (k in o) walk(o[k], depth + 1)
  }
  for (const recap of rec.ai_notes ?? []) {
    const r = recap as { is_active?: boolean }
    if (r && r.is_active === false) continue
    walk(recap, 0)
  }
  return out.join('\n')
}
