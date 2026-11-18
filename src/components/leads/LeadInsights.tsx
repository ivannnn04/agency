'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronRight, CircleHelp, Loader2, RefreshCw, Sparkles, ThumbsUp, Unlink, Video, Zap,
} from 'lucide-react'

// Fellow notetaker + AI deal overview pieces of the leads board. All data
// comes from admin-only API routes; the tables are closed to the browser.

export interface LeadScore { win_probability: number; confidence: string; next_step: string; generated_at: string }
export interface UnmatchedMeeting { id: string; title: string; started_at: string | null; attendees: string[] }
export interface Insights {
  scores: Record<string, LeadScore>
  meetingStats: Record<string, { count: number; last: string | null }>
  unmatched: UnmatchedMeeting[]
  fellow: { configured: boolean; last_synced_at: string | null; last_error: string | null; webhook: boolean }
}

interface Overview {
  win_probability: number
  confidence: 'low' | 'medium' | 'high'
  summary: string
  positive_signals: string[]
  risks: string[]
  clarify: { question: string; why: string }[]
  fit_points: string[]
  next_step: string
  generated_at: string
}
interface Meeting {
  id: string
  title: string
  started_at: string | null
  attendees: string[]
  recap: string | null
  transcript: string | null
  match_reason: string | null
}

export function scoreTone(p: number) {
  if (p >= 65) return { text: 'text-green-700', bg: 'bg-green-100', bar: 'bg-green-500' }
  if (p >= 35) return { text: 'text-amber-700', bg: 'bg-amber-50', bar: 'bg-amber-500' }
  return { text: 'text-red-600', bg: 'bg-red-50', bar: 'bg-red-400' }
}

const CONFIDENCE: Record<string, string> = { low: 'мало даних', medium: 'середня впевненість', high: 'висока впевненість' }
const REASON: Record<string, string> = { email: 'за email', domain: 'за доменом', name: 'за назвою', manual: 'вручну' }

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function ago(iso: string | null) {
  if (!iso) return 'ще не синхронізовано'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'щойно'
  if (min < 60) return `${min} хв тому`
  if (min < 60 * 24) return `${Math.round(min / 60)} год тому`
  return `${Math.round(min / 1440)} дн тому`
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data as T
}

// ── Sync status + calls that could not be matched to a lead ───────────────────

export function FellowBar({ insights, error, leads, syncing, onSync, onChanged }: {
  insights: Insights | null
  error: string
  leads: { id: string; name: string }[]
  syncing: boolean
  onSync: () => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  if (error) {
    return <div className="mb-4 text-xs bg-amber-50 border border-amber-100 text-amber-700 rounded-xl px-4 py-2.5">Fellow / AI-огляд: {error}</div>
  }
  if (!insights) return null
  const { fellow, unmatched } = insights

  if (!fellow.configured) {
    return (
      <div className="mb-4 text-xs bg-gray-50 border border-gray-100 text-gray-500 rounded-xl px-4 py-2.5 flex items-center gap-2">
        <Video size={13} className="flex-shrink-0" />
        Щоб дзвінки з Fellow самі потрапляли до лідів, додай у Vercel змінні FELLOW_API_KEY і FELLOW_SUBDOMAIN та зроби Redeploy.
      </div>
    )
  }

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id)
    setNote('')
    try {
      await call('/api/leads/meetings', 'PATCH', { id, ...body })
      onChanged()
    } catch (e) {
      setNote((e as Error).message)
    }
    setBusy(null)
  }

  async function enableWebhook() {
    setBusy('webhook')
    setNote('')
    try {
      await call('/api/fellow/connect', 'POST')
      onChanged()
    } catch (e) {
      setNote((e as Error).message)
    }
    setBusy(null)
  }

  return (
    <div className="mb-4 border border-gray-100 rounded-2xl bg-white">
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Video size={13} /> Fellow</span>
        <span className="text-xs text-gray-400">{syncing ? 'синхронізація…' : ago(fellow.last_synced_at)}</span>
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Синхронізувати
        </button>
        {fellow.webhook ? (
          <span className="flex items-center gap-1 text-xs text-green-700"><Zap size={11} /> миттєво після дзвінка</span>
        ) : (
          <button
            onClick={enableWebhook}
            disabled={busy === 'webhook'}
            className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
            title="Fellow сам повідомлятиме платформу, щойно нотатки дзвінка готові"
          >
            {busy === 'webhook' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />} Увімкнути миттєву синхронізацію
          </button>
        )}
        {unmatched.length > 0 && (
          <button onClick={() => setOpen(v => !v)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-amber-700">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Нерозібрані дзвінки · {unmatched.length}
          </button>
        )}
      </div>
      {(note || fellow.last_error) && <p className="px-4 pb-2.5 text-xs text-red-500">{note || fellow.last_error}</p>}

      {open && unmatched.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {unmatched.map(m => (
            <div key={m.id} className="px-4 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-medium text-gray-800 truncate">{m.title}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  {fmtDay(m.started_at)}{m.attendees.length > 0 ? ` · ${m.attendees.join(', ')}` : ''}
                </p>
              </div>
              {busy === m.id ? (
                <span className="flex items-center gap-1.5 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> аналізую…</span>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value=""
                    onChange={e => { if (e.target.value) act(m.id, { lead_id: e.target.value }) }}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 max-w-44 focus:outline-none"
                  >
                    <option value="">До ліда…</option>
                    {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <button
                    onClick={() => act(m.id, { create_lead: true, name: m.title })}
                    className="text-xs font-medium bg-gray-900 hover:bg-gray-700 text-white rounded-lg px-2.5 py-1.5"
                  >
                    + Новий лід
                  </button>
                  <button
                    onClick={() => act(m.id, { ignored: true })}
                    className="text-xs text-gray-400 hover:text-gray-600 px-1"
                    title="Це не дзвінок із лідом — сховати"
                  >
                    Не продаж
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AI overview + calls inside a lead's card ──────────────────────────────────

function Bullets({ icon, title, items, tone }: { icon: React.ReactNode; title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${tone}`}>{icon} {title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-sm text-gray-700 leading-snug pl-3 border-l-2 border-gray-100">{t}</li>
        ))}
      </ul>
    </div>
  )
}

export function LeadInsightPanel({ leadId, onChanged }: { leadId: string; onChanged: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [openMeeting, setOpenMeeting] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setOverview(null)
    setMeetings([])
    setError('')
    setOpenMeeting(null)
    call<{ overview: Overview | null; meetings: Meeting[] }>(`/api/leads/insights?lead=${leadId}`)
      .then(d => { if (alive) { setOverview(d.overview); setMeetings(d.meetings) } })
      .catch(e => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [leadId])

  async function regenerate() {
    setWorking(true)
    setError('')
    try {
      const d = await call<{ overview: Overview }>('/api/leads/insights', 'POST', { leadId })
      setOverview(d.overview)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
    setWorking(false)
  }

  async function detach(id: string) {
    if (!window.confirm('Відвʼязати цей дзвінок від ліда? Він повернеться в «Нерозібрані».')) return
    setMeetings(prev => prev.filter(m => m.id !== id))
    await call('/api/leads/meetings', 'PATCH', { id, lead_id: null }).catch(e => setError((e as Error).message))
    onChanged()
  }

  const tone = overview ? scoreTone(overview.win_probability) : null

  return (
    <>
      <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/60">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><Sparkles size={13} /> AI-огляд угоди</p>
          <button
            onClick={regenerate}
            disabled={working || loading}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            {working ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {working ? 'Аналізую…' : overview ? 'Оновити' : 'Згенерувати'}
          </button>
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        {loading ? (
          <p className="text-xs text-gray-300">Завантаження…</p>
        ) : !overview || !tone ? (
          <p className="text-xs text-gray-400 leading-relaxed">
            Огляду ще немає. Натисни «Згенерувати» — AI оцінить шанс виграти угоду за листуванням, нотатками й дзвінками з Fellow
            і підкаже, що ще треба зʼясувати в ліда.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-end gap-2.5 mb-2">
                <span className={`text-4xl font-bold leading-none ${tone.text}`}>{overview.win_probability}%</span>
                <span className="text-xs text-gray-400 pb-0.5">шанс виграти · {CONFIDENCE[overview.confidence] ?? ''}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${overview.win_probability}%` }} />
              </div>
            </div>

            <p className="text-sm text-gray-700 leading-relaxed">{overview.summary}</p>

            {overview.next_step && (
              <div className="bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Наступний крок</p>
                <p className="text-sm font-medium text-gray-900 leading-snug">{overview.next_step}</p>
              </div>
            )}

            {overview.clarify.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-blue-700">
                  <CircleHelp size={12} /> Що зʼясувати в ліда
                </p>
                <div className="flex flex-col gap-2">
                  {overview.clarify.map((c, i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                      <p className="text-sm text-gray-900 leading-snug">{c.question}</p>
                      {c.why && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{c.why}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Bullets icon={<Sparkles size={12} />} title="Як показати, що ми найкращий вибір" items={overview.fit_points} tone="text-violet-700" />
            <Bullets icon={<ThumbsUp size={12} />} title="Сигнали «за»" items={overview.positive_signals} tone="text-green-700" />
            <Bullets icon={<AlertTriangle size={12} />} title="Ризики" items={overview.risks} tone="text-red-600" />

            <p className="text-[10px] text-gray-300">Оновлено {fmtDay(overview.generated_at)}</p>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Дзвінки (Fellow) · {meetings.length}</p>
        {meetings.length === 0 ? (
          <p className="text-xs text-gray-300">
            Дзвінків ще немає. Вони зʼявляються автоматично, коли email учасника збігається з email ліда,
            або привʼяжи дзвінок вручну з «Нерозібраних».
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {meetings.map(m => {
              const open = openMeeting === m.id
              return (
                <div key={m.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div
                    onClick={() => { setOpenMeeting(open ? null : m.id); setShowTranscript(false) }}
                    className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  >
                    {open ? <ChevronDown size={13} className="text-gray-300 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />}
                    <Video size={13} className="text-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{m.title}</p>
                      <p className="text-[11px] text-gray-400">
                        {fmtDay(m.started_at)}{m.match_reason ? ` · привʼязано ${REASON[m.match_reason] ?? ''}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); detach(m.id) }}
                      className="text-gray-300 hover:text-red-400 p-1 flex-shrink-0"
                      title="Відвʼязати від ліда"
                    >
                      <Unlink size={12} />
                    </button>
                  </div>
                  {open && (
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      {m.attendees.length > 0 && <p className="text-[11px] text-gray-400 break-words">{m.attendees.join(', ')}</p>}
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                        {m.recap?.trim() || 'Fellow ще не згенерував нотатки для цього дзвінка.'}
                      </div>
                      {m.transcript?.trim() && (
                        <>
                          <button onClick={() => setShowTranscript(v => !v)} className="self-start text-xs font-medium text-gray-500 hover:text-gray-900">
                            {showTranscript ? 'Сховати транскрипт' : 'Показати транскрипт'}
                          </button>
                          {showTranscript && (
                            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                              {m.transcript}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
