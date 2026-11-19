'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, BookOpen, Check, FileText, Mail, TrendingUp, ChevronDown, ChevronRight, CircleHelp, Copy, Loader2, RefreshCw, Sparkles, ThumbsUp,
  Unlink, Video, Zap,
} from 'lucide-react'
import { DEAL_FACTORS, FactorScore, Lever, factorPoints } from '@/lib/dealFactors'

// Fellow notetaker + AI deal overview pieces of the leads board. All data
// comes from admin-only API routes; the tables are closed to the browser.

export interface LeadScore { win_probability: number; confidence: string; next_step: string; generated_at: string }
export interface UnmatchedMeeting { id: string; title: string; started_at: string | null; attendees: string[] }
export interface Insights {
  scores: Record<string, LeadScore>
  meetingStats: Record<string, { count: number; last: string | null }>
  unmatched: UnmatchedMeeting[]
  pending: number
  agency_profile: string
  fellow: { configured: boolean; last_synced_at: string | null; last_error: string | null; webhook: boolean }
  mail?: { configured: boolean; last_synced_at: string | null; last_error: string | null }
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
  call_agenda?: { topic: string; goal: string }[]
  message_draft?: string
  materials?: { what: string; why: string }[]
  factors?: FactorScore[]
  why_not_higher?: string
  why_not_lower?: string
  levers?: Lever[]
  potential?: number
  version?: number
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
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  if (error && !insights) {
    return <div className="mb-4 text-xs bg-amber-50 border border-amber-100 text-amber-700 rounded-xl px-4 py-2.5">Fellow / AI-огляд: {error}</div>
  }
  if (!insights) return null
  const { fellow, unmatched, mail } = insights

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

  // The server analyses a few leads per request; keep asking until none remain
  async function analyseAll() {
    const total = insights?.pending ?? 0
    if (total === 0 || bulk) return
    setNote('')
    setBulk({ done: 0, total })
    let done = 0
    try {
      for (;;) {
        const r = await call<{ done: number; remaining: number; error: string | null }>('/api/leads/insights', 'POST', { all: true })
        done += r.done
        setBulk({ done, total })
        onChanged()
        if (r.error) setNote(r.error)
        if (r.remaining <= 0 || r.done === 0) break
      }
    } catch (e) {
      setNote((e as Error).message)
    }
    setBulk(null)
    onChanged()
  }

  async function saveProfile() {
    setBusy('profile')
    setNote('')
    try {
      await call('/api/leads/insights', 'PUT', { agency_profile: profile })
      setProfileSaved(true)
      onChanged()
    } catch (e) {
      setNote((e as Error).message)
    }
    setBusy(null)
  }

  const link = 'flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50'

  return (
    <div className="mb-4 border border-gray-100 rounded-2xl bg-white">
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Video size={13} /> Fellow</span>
        {fellow.configured ? (
          <>
            <span className="text-xs text-gray-400">{syncing ? 'синхронізація…' : ago(fellow.last_synced_at)}</span>
            <button onClick={onSync} disabled={syncing} className={link}>
              <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Синхронізувати
            </button>
            {fellow.webhook ? (
              <span className="flex items-center gap-1 text-xs text-green-700"><Zap size={11} /> миттєво після дзвінка</span>
            ) : (
              <button
                onClick={enableWebhook}
                disabled={busy === 'webhook'}
                className={link}
                title="Fellow сам повідомлятиме платформу, щойно нотатки дзвінка готові"
              >
                {busy === 'webhook' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />} Увімкнути миттєву синхронізацію
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400">не підключено — додай FELLOW_API_KEY і FELLOW_SUBDOMAIN у Vercel</span>
        )}

        {mail?.configured && (
          <>
            <span className="w-px h-3.5 bg-gray-200" />
            <span
              className="flex items-center gap-1.5 text-xs text-gray-400"
              title="Відповіді лідів і листи, надіслані поза платформою, підтягуються в картку ліда"
            >
              <Mail size={12} className="text-gray-600" />
              <span className="font-semibold text-gray-700">Пошта</span> {syncing ? 'синхронізація…' : ago(mail.last_synced_at)}
            </span>
          </>
        )}

        <span className="w-px h-3.5 bg-gray-200" />
        {bulk ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <Loader2 size={11} className="animate-spin" /> AI-огляд: {bulk.done} з {bulk.total}
          </span>
        ) : insights.pending > 0 ? (
          <button onClick={analyseAll} className={link} title="Оцінити шанс і підготувати план для кожного відкритого ліда">
            <Sparkles size={11} /> AI-огляд для всіх лідів · {insights.pending}
          </button>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-400"><Sparkles size={11} /> AI-огляд є в усіх лідів</span>
        )}
        <button
          onClick={() => { setProfile(insights.agency_profile); setProfileSaved(false); setProfileOpen(v => !v) }}
          className={link}
          title="Кейси, посилання й матеріали агенції, які AI може радити надсилати лідам"
        >
          <BookOpen size={11} /> Матеріали агенції
        </button>

        {unmatched.length > 0 && (
          <button onClick={() => setOpen(v => !v)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-amber-700">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Нерозібрані дзвінки · {unmatched.length}
          </button>
        )}
      </div>
      {(note || error || fellow.last_error || mail?.last_error) && (
        <p className="px-4 pb-2.5 text-xs text-red-500">{note || error || fellow.last_error || mail?.last_error}</p>
      )}

      {profileOpen && (
        <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-2">
          <p className="text-xs text-gray-500 leading-relaxed">
            Опиши, що Gudrix може показати клієнту: кейси з нішею й результатом, посилання на Dribbble / Behance / сайт, презентації,
            відгуки, типові пакети послуг. AI радитиме надсилати лідам саме це, а не загальні поради.
          </p>
          <textarea
            value={profile}
            onChange={e => { setProfile(e.target.value); setProfileSaved(false) }}
            rows={8}
            placeholder={'Напр.:\n• Кейс «Назва» — fintech-дашборд, редизайн за 6 тижнів, посилання…\n• Презентація агенції: посилання…\n• Відгуки клієнтів: посилання…'}
            className="w-full text-sm text-gray-700 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y leading-relaxed"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={saveProfile}
              disabled={busy === 'profile'}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              {busy === 'profile' && <Loader2 size={11} className="animate-spin" />} Зберегти
            </button>
            {profileSaved && <span className="text-xs text-green-700">Збережено — врахується в наступних оглядах</span>}
          </div>
        </div>
      )}

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

type Tab = 'overview' | 'call' | 'write' | 'materials'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Огляд' },
  { key: 'call', label: 'Дзвінок' },
  { key: 'write', label: 'Повідомлення' },
  { key: 'materials', label: 'Матеріали' },
]

function Pairs({ items, a, b }: { items: Record<string, string>[]; a: string; b: string }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2">
          <p className="text-sm text-gray-900 leading-snug">{it[a]}</p>
          {it[b] && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{it[b]}</p>}
        </div>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard access */ }
      }}
      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Скопійовано' : 'Копіювати'}
    </button>
  )
}

const Label = ({ children, tone = 'text-gray-400' }: { children: React.ReactNode; tone?: string }) => (
  <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${tone}`}>{children}</p>
)

// Where the percentage comes from: points earned per factor, with the evidence
function Scorecard({ factors }: { factors: FactorScore[] }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
      {DEAL_FACTORS.map(def => {
        const f = factors.find(x => x.key === def.key)
        if (!f) return null
        const bar = f.score >= 70 ? 'bg-green-500' : f.score >= 40 ? 'bg-amber-500' : 'bg-red-400'
        return (
          <div key={def.key} className="px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <p className="text-[13px] font-medium text-gray-900 flex-1 min-w-0 truncate">{def.label}</p>
              <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${f.score}%` }} />
              </div>
              <p className="text-xs tabular-nums text-gray-500 w-14 text-right flex-shrink-0">
                <span className="font-semibold text-gray-900">{factorPoints(f)}</span> з {def.weight}
              </p>
            </div>
            <p className="text-xs text-gray-600 leading-snug mt-1">{f.evidence}</p>
            {f.gap && <p className="text-[11px] text-gray-400 leading-snug mt-0.5">Бракує: {f.gap}</p>}
          </div>
        )
      })}
    </div>
  )
}

function Levers({ levers, current, potential }: { levers: Lever[]; current: number; potential: number }) {
  if (levers.length === 0) return null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <Label tone="text-green-700"><TrendingUp size={12} /> Що підніме шанс</Label>
        {potential > current && <span className="text-[11px] text-gray-400">разом: {current}% → до {potential}%</span>}
      </div>
      <div className="flex flex-col gap-2">
        {levers.map((l, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex gap-2.5">
            <span className="text-[11px] font-semibold text-green-700 bg-green-100 rounded-md px-1.5 py-0.5 h-fit flex-shrink-0 tabular-nums">+{l.uplift}%</span>
            <div className="min-w-0">
              <p className="text-sm text-gray-900 leading-snug">{l.action}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                {DEAL_FACTORS.find(d => d.key === l.factor)?.label}{l.why ? ` · ${l.why}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Technical task for the design team, written as a prompt
function LeadBriefCard({ leadId }: { leadId: string }) {
  const [brief, setBrief] = useState<{ content: string; lang: 'en' | 'uk'; generated_at: string } | null>(null)
  const [lang, setLang] = useState<'en' | 'uk'>('en')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let alive = true
    setBrief(null)
    setError('')
    setWorking(false)
    call<{ brief: typeof brief }>(`/api/leads/brief?lead=${leadId}`)
      .then(d => { if (alive && d.brief) { setBrief(d.brief); setLang(d.brief.lang) } })
      .catch(() => {})
    return () => { alive = false }
  }, [leadId])

  async function generate() {
    setWorking(true)
    setError('')
    try {
      const d = await call<{ brief: NonNullable<typeof brief> }>('/api/leads/brief', 'POST', { leadId, lang })
      setBrief(d.brief)
      setOpen(true)
    } catch (e) {
      setError((e as Error).message)
    }
    setWorking(false)
  }

  return (
    <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/60">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
          <FileText size={13} /> ТЗ для дизайну (у форматі промпту)
        </button>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 rounded-md p-0.5">
            {(['en', 'uk'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`text-[11px] font-medium px-2 py-0.5 rounded ${lang === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                {l === 'en' ? 'EN' : 'UA'}
              </button>
            ))}
          </div>
          {brief && <CopyButton text={brief.content} />}
          <button
            onClick={generate}
            disabled={working}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            {working ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {working ? 'Пишу…' : brief ? 'Оновити' : 'Згенерувати'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {!brief ? (
        <p className="text-xs text-gray-400 leading-relaxed mt-2">
          {working
            ? 'AI збирає вимоги клієнта з дзвінків і листування — до хвилини-двох.'
            : 'Технічне завдання з усього, що клієнт сказав на дзвінках і в листах: контекст, мета, обсяг, вимоги, стиль, обмеження й відкриті питання. Його можна віддати дизайнеру або вставити в AI-інструмент.'}
        </p>
      ) : open && (
        <>
          <div className="bg-white border border-gray-100 rounded-xl px-3 py-3 mt-3 text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed max-h-[520px] overflow-y-auto">
            {brief.content}
          </div>
          <p className="text-[10px] text-gray-300 mt-2">
            Оновлено {fmtDay(brief.generated_at)} · лише те, що є в матеріалах ліда; чого бракує — у розділі відкритих питань
          </p>
        </>
      )}
    </div>
  )
}

export function LeadInsightPanel({ leadId, onChanged }: { leadId: string; onChanged: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [openMeeting, setOpenMeeting] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const autoFor = useRef<string | null>(null)

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

  useEffect(() => {
    let alive = true
    setLoading(true)
    setOverview(null)
    setMeetings([])
    setError('')
    setTab('overview')
    setOpenMeeting(null)
    call<{ overview: Overview | null; meetings: Meeting[] }>(`/api/leads/insights?lead=${leadId}`)
      .then(d => {
        if (!alive) return
        setOverview(d.overview)
        setMeetings(d.meetings)
        // No overview yet, or one from before the call plan / materials existed
        if ((!d.overview || (d.overview.version ?? 1) < 3) && autoFor.current !== leadId) {
          autoFor.current = leadId
          regenerate()
        }
      })
      .catch(e => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId])

  async function detach(id: string) {
    if (!window.confirm('Відвʼязати цей дзвінок від ліда? Він повернеться в «Нерозібрані».')) return
    setMeetings(prev => prev.filter(m => m.id !== id))
    await call('/api/leads/meetings', 'PATCH', { id, lead_id: null }).catch(e => setError((e as Error).message))
    onChanged()
  }

  const tone = overview ? scoreTone(overview.win_probability) : null
  const agenda = overview?.call_agenda ?? []
  const materials = overview?.materials ?? []
  const draft = overview?.message_draft ?? ''
  const empty = (text: string) => <p className="text-xs text-gray-400 leading-relaxed">{text}</p>

  return (
    <>
      <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/60">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><Sparkles size={13} /> AI-асистент по угоді</p>
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
            {working
              ? 'AI читає листування, нотатки й дзвінки цього ліда — це займає до хвилини.'
              : 'Огляду ще немає. Натисни «Згенерувати» — AI оцінить шанс виграти угоду й підготує план дзвінка, повідомлення та матеріали.'}
          </p>
        ) : (
          <>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 mb-4">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                    tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
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
                <Levers levers={overview.levers ?? []} current={overview.win_probability} potential={overview.potential ?? overview.win_probability} />
                {(overview.factors?.length ?? 0) > 0 && (
                  <div>
                    <Label>Чому саме {overview.win_probability}% — бали за факторами</Label>
                    <Scorecard factors={overview.factors!} />
                    {(overview.why_not_higher || overview.why_not_lower) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {overview.why_not_higher && (
                          <div className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                            <p className="text-[11px] font-semibold text-red-600 mb-0.5">Чому не вище</p>
                            <p className="text-xs text-gray-700 leading-snug">{overview.why_not_higher}</p>
                          </div>
                        )}
                        {overview.why_not_lower && (
                          <div className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                            <p className="text-[11px] font-semibold text-green-700 mb-0.5">Чому не нижче</p>
                            <p className="text-xs text-gray-700 leading-snug">{overview.why_not_lower}</p>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 mt-2 leading-snug">
                      Відсоток — це сума балів: кожен фактор оцінено від 0 до 100 за тим, що клієнт сказав і зробив, і помножено на його вагу.
                      Це структурована оцінка, а не статистика по твоїх минулих угодах.
                    </p>
                  </div>
                )}
                {overview.next_step && (
                  <div className="bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                    <Label>Наступний крок</Label>
                    <p className="text-sm font-medium text-gray-900 leading-snug">{overview.next_step}</p>
                  </div>
                )}
                <Bullets icon={<ThumbsUp size={12} />} title="Сигнали «за»" items={overview.positive_signals} tone="text-green-700" />
                <Bullets icon={<AlertTriangle size={12} />} title="Ризики" items={overview.risks} tone="text-red-600" />
              </div>
            )}

            {tab === 'call' && (
              <div className="flex flex-col gap-4">
                <div>
                  <Label>Теми для наступного дзвінка</Label>
                  {agenda.length > 0 ? (
                    <ol className="flex flex-col gap-2">
                      {agenda.map((t, i) => (
                        <li key={i} className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex gap-2.5">
                          <span className="text-xs font-semibold text-gray-300 pt-0.5">{i + 1}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900 leading-snug">{t.topic}</p>
                            {t.goal && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{t.goal}</p>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : empty('Плану дзвінка ще немає — натисни «Оновити».')}
                </div>
                {overview.clarify.length > 0 && (
                  <div>
                    <Label tone="text-blue-700"><CircleHelp size={12} /> Питання, які варто поставити</Label>
                    <Pairs items={overview.clarify} a="question" b="why" />
                  </div>
                )}
              </div>
            )}

            {tab === 'write' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>Повідомлення ліду</Label>
                  {draft && <CopyButton text={draft} />}
                </div>
                {draft ? (
                  <div className="bg-white border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{draft}</div>
                ) : empty('Чернетки ще немає — натисни «Оновити».')}
                <p className="text-[11px] text-gray-400 mt-2">Це чернетка: перечитай і підправ під свій тон перед відправкою.</p>
              </div>
            )}

            {tab === 'materials' && (
              <div className="flex flex-col gap-4">
                <div>
                  <Label>Що надіслати, щоб підсилити інтерес</Label>
                  {materials.length > 0 ? <Pairs items={materials} a="what" b="why" /> : empty('Порад ще немає — натисни «Оновити».')}
                </div>
                <Bullets icon={<Sparkles size={12} />} title="Як показати, що ми найкращий вибір" items={overview.fit_points} tone="text-violet-700" />
                <p className="text-[11px] text-gray-400">
                  Щоб AI радив конкретні кейси й посилання, заповни «Матеріали агенції» над бордою лідів.
                </p>
              </div>
            )}

            <p className="text-[10px] text-gray-300 mt-4">Оновлено {fmtDay(overview.generated_at)}</p>
          </>
        )}
      </div>

      <LeadBriefCard leadId={leadId} />

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
