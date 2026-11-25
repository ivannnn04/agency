'use client'

import { useEffect } from 'react'
import { Calendar, Check, Clock, FilePen, Flag, ListTree, Users, X } from 'lucide-react'
import RichDescription from '@/components/RichDescription'
import { PortalLang, PortalText, portalLocale } from '@/lib/portalI18n'

// A task opened by the client: everything about it, to read only. The
// description keeps its formatting (lists, checklists, highlights) but cannot
// be edited, ticked or changed here; the client asks for changes instead.

export interface DrawerTask {
  id: string; title: string; description: string | null; description_html?: string | null
  priority: string | null; start_date: string | null; due_date: string | null
  estimate_status?: string | null; estimate_hours?: number | null; estimate_cost?: number | null
}

const PRIORITY_COLOR: Record<string, string> = { low: '#9CA3AF', medium: '#F59E0B', high: '#EF4444' }

function hours(seconds: number, lang: PortalLang): string {
  const [hh, mm] = lang === 'uk' ? [' год', ' хв'] : ['h', 'm']
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}${mm}`
  return m > 0 ? `${h}${hh} ${m}${mm}` : `${h}${hh}`
}

export default function PortalTaskDrawer({
  task, column, people, seconds, amount, money, subtasks, requests, t, lang, canRequest, requestLabel, onRequestChanges, onClose,
}: {
  task: DrawerTask
  column: { name: string; color: string } | null
  people: string[]
  seconds: number | null
  amount: string | null
  money: (n: number) => string
  subtasks: { title: string; done: boolean }[]
  requests: { id: string; content: string; status: 'open' | 'done'; created_at: string }[]
  t: PortalText
  lang: PortalLang
  canRequest: boolean
  requestLabel: string
  onRequestChanges: () => void
  onClose: () => void
}) {
  const locale = portalLocale(lang)
  const day = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const doneSubs = subtasks.filter(s => s.done).length
  const agreed = task.estimate_status === 'approved' && (task.estimate_hours || task.estimate_cost)
  const rows: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = []
  if (people.length) rows.push({ icon: <Users size={14} />, label: t.tdTeam, value: people.join(', ') })
  if (task.start_date || task.due_date) {
    rows.push({ icon: <Calendar size={14} />, label: t.tdDates, value: [task.start_date && day(task.start_date), task.due_date && day(task.due_date)].filter(Boolean).join(' → ') })
  }
  if (seconds != null && seconds > 0) rows.push({ icon: <Clock size={14} />, label: t.tdTime, value: <>{hours(seconds, lang)}{amount ? <span className="text-gray-900 font-semibold"> · {amount}</span> : null}</> })
  if (agreed) {
    rows.push({
      icon: <Check size={14} />, label: t.tdEstimate,
      value: [task.estimate_hours ? `${task.estimate_hours}${lang === 'uk' ? ' год' : 'h'}` : '', task.estimate_cost ? money(Number(task.estimate_cost)) : ''].filter(Boolean).join(' · '),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={task.title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          {column && (
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-gray-500">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: column.color }} /> {column.name}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: PRIORITY_COLOR[task.priority ?? 'medium'] }}>
            <Flag size={12} /> {t.priority[task.priority ?? 'medium']}
          </span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-900 p-1 rounded-full" aria-label={t.tdClose} title={t.tdClose}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <h2 className="text-2xl font-semibold text-gray-900 tracking-tight leading-snug">{task.title}</h2>

          {rows.length > 0 && (
            <dl className="mt-5 flex flex-col gap-2.5">
              {rows.map(r => (
                <div key={r.label} className="flex items-start gap-3 text-sm">
                  <dt className="flex items-center gap-2 text-gray-400 w-28 sm:w-36 flex-shrink-0">{r.icon} {r.label}</dt>
                  <dd className="text-gray-700 min-w-0">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-7">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400 mb-3">{t.tdDescription}</p>
            {task.description_html?.trim() || task.description?.trim()
              ? <RichDescription key={task.id} readOnly html={task.description_html} text={task.description} />
              : <p className="text-sm text-gray-400">{t.tdNoDescription}</p>}
          </div>

          {subtasks.length > 0 && (
            <div className="mt-7">
              <div className="flex items-center gap-2 mb-3">
                <ListTree size={14} className="text-gray-400" />
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">{t.tdSubtasks}</p>
                <span className="text-xs text-gray-400 tabular-nums">{doneSubs}/{subtasks.length}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[140px] ml-1">
                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(doneSubs / subtasks.length) * 100}%` }} />
                </div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {subtasks.map((s, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${s.done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300'}`}>
                      {s.done && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className={s.done ? 'text-gray-400 line-through' : 'text-gray-700'}>{s.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {requests.length > 0 && (
            <div className="mt-7">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400 mb-3">{t.tdRequests}</p>
              <div className="flex flex-col gap-2">
                {requests.map(cr => (
                  <div key={cr.id} className="border border-gray-100 rounded-2xl px-4 py-3">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{cr.content || t.attachedFiles}</p>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {new Date(cr.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} · {cr.status === 'done' ? t.crDone : t.crOpen}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {canRequest && (
          <div className="px-6 py-4 border-t border-gray-100">
            <button onClick={onRequestChanges}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:border-gray-900 rounded-full py-2.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              <FilePen size={14} /> {requestLabel}
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
