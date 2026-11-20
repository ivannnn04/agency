'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Clock, FolderKanban, Loader2, RefreshCw, Sparkles, Video } from 'lucide-react'
import { ProjectMetrics } from '@/lib/projectFactors'
import { HEALTH_STATUS } from '@/components/ProjectOverview'

// All active projects at a glance: health, progress, deadline and the calls
// synced from Fellow. Each card opens the project.

interface Card {
  id: string
  name: string
  color: string | null
  metrics: ProjectMetrics | null
  review: { health: number; status: string; summary: string; deadline_outlook: string; generated_at: string } | null
}
interface Payload {
  projects: Card[]
  pending: number
  fellow: { configured: boolean; last_synced_at: string | null; last_error: string | null }
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '—'

function ago(iso: string | null) {
  if (!iso) return 'ще не синхронізовано'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'щойно'
  if (min < 60) return `${min} хв тому`
  if (min < 1440) return `${Math.round(min / 60)} год тому`
  return `${Math.round(min / 1440)} дн тому`
}

export default function BoardIndexPage() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects/review')
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setData(d as Payload)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function syncFellow() {
    setSyncing(true)
    setError('')
    try {
      const res = await fetch('/api/fellow/sync', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(d.error ?? `HTTP ${res.status}`)
    } catch (e) {
      setError((e as Error).message)
    }
    setSyncing(false)
    load()
  }

  // The server reviews a few projects per request; keep asking until done
  async function reviewAll() {
    const total = data?.pending ?? 0
    if (total === 0 || bulk) return
    setError('')
    setBulk({ done: 0, total })
    let done = 0
    try {
      for (;;) {
        const res = await fetch('/api/projects/review', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
        })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) { setError(r.error ?? `HTTP ${res.status}`); break }
        done += r.done ?? 0
        setBulk({ done, total })
        if (r.error) setError(r.error)
        if ((r.remaining ?? 0) <= 0 || !r.done) break
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setBulk(null)
    load()
  }

  const link = 'flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50'

  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Проєкти</h1>
        <p className="text-sm text-gray-500 mt-0.5">Як рухається кожен проєкт і чи вкладаємось у дедлайни</p>
      </div>

      <div className="mb-4 border border-gray-100 rounded-2xl bg-white flex items-center gap-x-3 gap-y-1.5 flex-wrap px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Video size={13} /> Fellow</span>
        {data?.fellow.configured ? (
          <>
            <span className="text-xs text-gray-400">{syncing ? 'синхронізація…' : ago(data.fellow.last_synced_at)}</span>
            <button onClick={syncFellow} disabled={syncing} className={link}>
              <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Синхронізувати дзвінки
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-400">{data ? 'не підключено' : '…'}</span>
        )}
        <span className="w-px h-3.5 bg-gray-200" />
        {bulk ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={11} className="animate-spin" /> AI-огляд: {bulk.done} з {bulk.total}</span>
        ) : data && data.pending > 0 ? (
          <button onClick={reviewAll} className={link}><Sparkles size={11} /> AI-огляд для всіх проєктів · {data.pending}</button>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-400"><Sparkles size={11} /> {data ? 'AI-огляд є в усіх проєктів' : '…'}</span>
        )}
        {error && <span className="text-xs text-red-500 basis-full">{error}</span>}
      </div>

      {!data ? (
        <p className="text-sm text-gray-400 py-16 text-center">{error ? '' : 'Завантаження…'}</p>
      ) : data.projects.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FolderKanban size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Активних проєктів ще немає — створи проєкт у меню зліва</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.projects.map(p => {
            const m = p.metrics
            const st = p.review ? HEALTH_STATUS[p.review.status] ?? HEALTH_STATUS.at_risk : null
            const late = m?.forecast_days_late ?? null
            return (
              <button
                key={p.id}
                onClick={() => router.push(`/board/${p.id}`)}
                className="text-left bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-300 hover:shadow-sm transition-all flex flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  <span className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: p.color ?? '#9ca3af' }} />
                  <p className="text-base font-semibold text-gray-900 leading-snug flex-1 min-w-0">{p.name}</p>
                  {p.review && st ? (
                    <span className={`flex items-baseline gap-1 px-2 py-1 rounded-lg flex-shrink-0 ${st.bg} ${st.text}`} title={st.label}>
                      <span className="text-lg font-bold leading-none">{p.review.health}</span>
                      <span className="text-[10px] font-medium">/100</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-300 flex-shrink-0 pt-1">без оцінки</span>
                  )}
                </div>

                {m && (
                  <>
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                        <span>{m.tasks_done} з {m.tasks_total} задач</span>
                        <span className="font-semibold text-gray-700">{m.progress_pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden relative">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${m.progress_pct}%` }} />
                        {m.time_elapsed_pct !== null && (
                          <div className="absolute top-0 bottom-0 w-0.5 bg-red-400" style={{ left: `${m.time_elapsed_pct}%` }} title="Скільки часу проєкту вже минуло" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs text-gray-600">
                      <span className="flex items-center gap-1" title="Дедлайн">
                        <CalendarClock size={12} className="text-gray-300" />
                        {m.deadline
                          ? <>{fmtDate(m.deadline)} <span className={m.days_left !== null && m.days_left < 0 ? 'text-red-600' : 'text-gray-400'}>({m.days_left !== null && m.days_left < 0 ? `−${-m.days_left}` : m.days_left} дн)</span></>
                          : <span className="text-gray-300">без дедлайну</span>}
                      </span>
                      {late !== null && late > 0 && <span className="text-red-600 font-medium">прогноз +{late} дн</span>}
                      {m.overdue.length > 0 && (
                        <span className="flex items-center gap-1 text-red-600"><AlertTriangle size={12} /> {m.overdue.length} простр.</span>
                      )}
                      <span className="flex items-center gap-1" title="Затрекано з оцінених годин">
                        <Clock size={12} className="text-gray-300" /> {m.tracked_hours_total} / {m.estimate_hours_total} год
                      </span>
                      {m.calls > 0 && <span className="flex items-center gap-1"><Video size={12} className="text-gray-300" /> {m.calls}</span>}
                    </div>
                  </>
                )}

                {p.review?.summary && <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{p.review.summary}</p>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
