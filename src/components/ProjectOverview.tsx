'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, BellRing, Gauge, Lightbulb, Loader2, RefreshCw, Rocket, Sparkles,
} from 'lucide-react'
import { PROJECT_FACTORS, ProjectFactorScore, ProjectMetrics, projectFactorPoints } from '@/lib/projectFactors'
import ProjectComms from '@/components/ProjectComms'
import { PMTask } from '@/types/pm'

// The project's overview tab: computed metrics, the AI review of how the
// project is going, and the calls attached to it. Admin-only data, served
// by /api/projects/*.

interface Review {
  health: number
  status: 'on_track' | 'at_risk' | 'off_track'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  deadline_outlook: string
  factors: ProjectFactorScore[]
  speed_up: { where: string; action: string; why: string }[]
  advice: string[]
  reminders: { text: string; when: string }[]
  risks: string[]
  generated_at: string
}
interface Meeting { id: string; title: string; started_at: string | null; attendees: string[]; recap?: string | null; transcript?: string | null }
interface Payload {
  metrics: ProjectMetrics
  review: Review | null
  meetings: Meeting[]
  candidates: Meeting[]
  needsMigration: boolean
  fellow: { configured: boolean; last_synced_at: string | null; last_error: string | null }
}

export const HEALTH_STATUS: Record<string, { label: string; text: string; bg: string; bar: string }> = {
  on_track: { label: 'Йде за планом', text: 'text-green-700', bg: 'bg-green-100', bar: 'bg-green-500' },
  at_risk: { label: 'Є ризики', text: 'text-amber-700', bg: 'bg-amber-50', bar: 'bg-amber-500' },
  off_track: { label: 'Під загрозою', text: 'text-red-600', bg: 'bg-red-50', bar: 'bg-red-400' },
}

const CONFIDENCE: Record<string, string> = { low: 'мало даних', medium: 'середня впевненість', high: 'висока впевненість' }
const CUR: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '—'
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

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

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
      <p className="text-[11px] text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold leading-tight ${tone ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{sub}</p>}
    </div>
  )
}

function Card({ icon, title, tone = 'text-gray-900', children }: { icon: React.ReactNode; title: string; tone?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4">
      <p className={`flex items-center gap-1.5 text-xs font-semibold mb-3 ${tone}`}>{icon} {title}</p>
      {children}
    </div>
  )
}

export default function ProjectOverview({ projectId, onOpenProgram, onTaskCreated }: {
  projectId: string
  onOpenProgram: () => void
  onTaskCreated?: (task: PMTask) => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const autoFor = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await call<Payload>(`/api/projects/review?project=${projectId}`)
      setData(d)
      return d
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [projectId])

  const regenerate = useCallback(async () => {
    setWorking(true)
    setError('')
    try {
      const d = await call<{ review: Review }>('/api/projects/review', 'POST', { projectId })
      setData(prev => (prev ? { ...prev, review: d.review } : prev))
    } catch (e) {
      setError((e as Error).message)
    }
    setWorking(false)
  }, [projectId])

  useEffect(() => {
    setData(null)
    setError('')
    load().then(d => {
      // First visit to a project with tasks: write the review without being asked
      if (d && !d.review && !d.needsMigration && d.metrics.tasks_total > 0 && autoFor.current !== projectId) {
        autoFor.current = projectId
        regenerate()
      }
    })
  }, [projectId, load, regenerate])

  async function attach(id: string, project_id: string | null) {
    setError('')
    try {
      await call('/api/projects/meetings', 'PATCH', { id, project_id })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!data) {
    return <p className="text-sm text-gray-400 p-6">{error || 'Завантаження…'}</p>
  }

  const { metrics: m, review, meetings, candidates, fellow } = data
  const st = review ? HEALTH_STATUS[review.status] ?? HEALTH_STATUS.at_risk : null
  const late = m.forecast_days_late
  const cur = m.contract ? CUR[m.contract.currency] ?? '' : ''
  const receivedSame = m.contract ? m.received[m.contract.currency] ?? 0 : 0

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-4">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {data.needsMigration && (
        <p className="text-xs bg-amber-50 border border-amber-100 text-amber-700 rounded-xl px-4 py-2.5">
          Для дат проєкту, роадмапу, дзвінків і AI-огляду запусти міграцію supabase/project_program_migration.sql у Supabase SQL Editor.
        </p>
      )}

      {/* Health + deadline */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><Sparkles size={13} /> Як іде проєкт</p>
            <button onClick={regenerate} disabled={working} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50">
              {working ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {working ? 'Аналізую…' : review ? 'Оновити' : 'Згенерувати'}
            </button>
          </div>
          {!review || !st ? (
            <p className="text-sm text-gray-400 leading-relaxed">
              {working
                ? 'AI читає борду, трекінг, чати й дзвінки проєкту — це займає до хвилини-двох.'
                : 'Огляду ще немає. Натисни «Згенерувати» — AI оцінить, наскільки добре рухається проєкт і чи вкладаємось у дедлайн.'}
            </p>
          ) : (
            <>
              <div className="flex items-end gap-3 mb-2 flex-wrap">
                <span className={`text-5xl font-bold leading-none ${st.text}`}>{review.health}</span>
                <span className="text-xs text-gray-400 pb-1">зі 100 · {CONFIDENCE[review.confidence]}</span>
                <span className={`text-xs font-semibold px-2 py-1 rounded-md mb-0.5 ${st.bg} ${st.text}`}>{st.label}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
                <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${review.health}%` }} />
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{review.summary}</p>
              <p className="text-[10px] text-gray-300 mt-3">Оновлено {fmtDay(review.generated_at)}</p>
            </>
          )}
        </div>

        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><Gauge size={13} /> Дедлайн</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-gray-400">Дедлайн</p>
              <p className="text-lg font-bold text-gray-900">{fmtDate(m.deadline)}</p>
              <p className="text-[11px] text-gray-400">
                {m.days_left === null ? 'не задано' : m.days_left < 0 ? `минув ${-m.days_left} дн тому` : `через ${m.days_left} дн`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Прогноз завершення</p>
              <p className={`text-lg font-bold ${late !== null && late > 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtDate(m.forecast_finish)}</p>
              <p className="text-[11px] text-gray-400">
                {late === null ? (m.forecast_finish ? 'за поточного темпу' : 'немає даних') : late > 0 ? `запізнення ~${late} дн` : `запас ${-late} дн`}
              </p>
            </div>
          </div>
          {review?.deadline_outlook && <p className="text-sm text-gray-700 leading-relaxed">{review.deadline_outlook}</p>}
          <p className="text-[11px] text-gray-400 leading-snug">{m.forecast_note}</p>
          {(!m.deadline || !m.start_date) && (
            <button onClick={onOpenProgram} className="self-start text-xs font-medium text-gray-900 underline">
              Задати старт і дедлайн у «Програмі»
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Прогрес" value={`${m.progress_pct}%`} sub={`${m.tasks_done} з ${m.tasks_total} задач`} />
        <Tile
          label="Часу минуло" value={m.time_elapsed_pct === null ? '—' : `${m.time_elapsed_pct}%`}
          sub={m.time_elapsed_pct === null ? 'немає дат проєкту' : m.progress_pct < m.time_elapsed_pct - 10 ? 'прогрес відстає від часу' : 'прогрес у темпі'}
          tone={m.time_elapsed_pct !== null && m.progress_pct < m.time_elapsed_pct - 10 ? 'text-red-600' : undefined}
        />
        <Tile label="Прострочено" value={String(m.overdue.length)} sub={m.due_soon.length > 0 ? `ще ${m.due_soon.length} на цьому тижні` : 'задач'} tone={m.overdue.length > 0 ? 'text-red-600' : undefined} />
        <Tile label="Години" value={`${m.tracked_hours_total}`} sub={`з ${m.estimate_hours_total} оцінених`} tone={m.estimate_hours_total > 0 && m.tracked_hours_total > m.estimate_hours_total ? 'text-red-600' : undefined} />
        <Tile label="Лишилось роботи" value={`${m.estimate_hours_remaining} год`} sub={`темп ${Math.round((m.tracked_hours_14d / 2) * 10) / 10} год/тиж`} />
        <Tile
          label="Оплата" value={m.contract ? `${cur}${Math.round(receivedSame).toLocaleString('en-US')}` : '—'}
          sub={m.contract ? `з ${cur}${m.contract.amount.toLocaleString('en-US')} за контрактом` : 'контракт не задано'}
        />
      </div>

      {review && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {review.speed_up.length > 0 && (
            <Card icon={<Rocket size={13} />} title="Де пришвидшити" tone="text-green-700">
              <div className="flex flex-col gap-2.5">
                {review.speed_up.map((s, i) => (
                  <div key={i} className="border-l-2 border-green-200 pl-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{s.where}</p>
                    <p className="text-sm text-gray-900 leading-snug">{s.action}</p>
                    {s.why && <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{s.why}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {review.reminders.length > 0 && (
            <Card icon={<BellRing size={13} />} title="Нагадування" tone="text-blue-700">
              <div className="flex flex-col gap-2">
                {review.reminders.map((r, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="text-[11px] font-medium text-blue-700 bg-blue-50 rounded-md px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap">{r.when}</span>
                    <p className="text-sm text-gray-800 leading-snug">{r.text}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {review.advice.length > 0 && (
            <Card icon={<Lightbulb size={13} />} title="Поради">
              <ul className="flex flex-col gap-1.5">
                {review.advice.map((a, i) => <li key={i} className="text-sm text-gray-700 leading-snug pl-3 border-l-2 border-gray-100">{a}</li>)}
              </ul>
            </Card>
          )}
          {review.risks.length > 0 && (
            <Card icon={<AlertTriangle size={13} />} title="Ризики" tone="text-red-600">
              <ul className="flex flex-col gap-1.5">
                {review.risks.map((a, i) => <li key={i} className="text-sm text-gray-700 leading-snug pl-3 border-l-2 border-red-100">{a}</li>)}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Scorecard */}
        {review && (
          <Card icon={<Gauge size={13} />} title={`Чому саме ${review.health} — бали за факторами`}>
            <div className="divide-y divide-gray-50 -my-1">
              {PROJECT_FACTORS.map(def => {
                const f = review.factors.find(x => x.key === def.key)
                if (!f) return null
                const bar = f.score >= 70 ? 'bg-green-500' : f.score >= 45 ? 'bg-amber-500' : 'bg-red-400'
                return (
                  <div key={def.key} className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <p className="text-[13px] font-medium text-gray-900 flex-1 min-w-0 truncate">{def.label}</p>
                      <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${f.score}%` }} />
                      </div>
                      <p className="text-xs tabular-nums text-gray-500 w-14 text-right flex-shrink-0">
                        <span className="font-semibold text-gray-900">{projectFactorPoints(f)}</span> з {def.weight}
                      </p>
                    </div>
                    <p className="text-xs text-gray-600 leading-snug mt-1">{f.evidence}</p>
                    {f.gap && <p className="text-[11px] text-gray-400 leading-snug mt-0.5">Виправити: {f.gap}</p>}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* What the board itself says */}
        <Card icon={<AlertTriangle size={13} />} title="Задачі, що потребують уваги">
          {m.overdue.length === 0 && m.due_soon.length === 0 && m.overruns.length === 0 ? (
            <p className="text-xs text-gray-400">Прострочених задач і перевитрат годин немає.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {m.overdue.slice(0, 6).map((t, i) => (
                <div key={`o${i}`} className="flex items-start gap-2.5">
                  <span className="text-[11px] font-medium text-red-600 bg-red-50 rounded-md px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap">−{t.days_late} дн</span>
                  <p className="text-sm text-gray-800 leading-snug min-w-0">{t.title} <span className="text-gray-400 text-xs">· {t.who}</span></p>
                </div>
              ))}
              {m.due_soon.slice(0, 5).map((t, i) => (
                <div key={`s${i}`} className="flex items-start gap-2.5">
                  <span className="text-[11px] font-medium text-amber-700 bg-amber-50 rounded-md px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap">до {fmtDate(t.due_date)}</span>
                  <p className="text-sm text-gray-800 leading-snug min-w-0">{t.title} <span className="text-gray-400 text-xs">· {t.who}</span></p>
                </div>
              ))}
              {m.overruns.slice(0, 4).map((t, i) => (
                <div key={`r${i}`} className="flex items-start gap-2.5">
                  <span className="text-[11px] font-medium text-violet-700 bg-violet-50 rounded-md px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap">{t.tracked} / {t.estimate} год</span>
                  <p className="text-sm text-gray-800 leading-snug min-w-0">{t.title}</p>
                </div>
              ))}
            </div>
          )}
          {(m.open_without_dates > 0 || m.open_without_estimate > 0 || m.open_without_assignee > 0) && (
            <p className="text-[11px] text-gray-400 mt-3 leading-snug">
              Відкриті задачі без дат: {m.open_without_dates} · без оцінки: {m.open_without_estimate} · без виконавця: {m.open_without_assignee}
            </p>
          )}
        </Card>
      </div>

      {/* Letters and calls with the client, and the action items from calls */}
      <ProjectComms
        projectId={projectId}
        meetings={meetings}
        candidates={candidates}
        fellow={fellow}
        onAttach={attach}
        onReload={load}
        onTaskCreated={onTaskCreated}
      />
    </div>
  )
}
