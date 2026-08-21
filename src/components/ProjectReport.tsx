'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { Project, TeamMember } from '@/types'
import { BarChart2, X, Clock } from 'lucide-react'
import { useChatWidth, ChatResizeHandle } from '@/components/chat/shared'

// Admin-only project report: every task with who worked on it, tracked hours
// and labor cost by member rates, next to the project budget and actual money.
// Mounted only on the admin board — the team and clients never see it.

interface TaskRow { id: string; title: string }
interface EntryRow { task_id: string; team_member_id: string; duration_seconds: number | null }

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function fmtDur(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return '—'
  if (h === 0) return `${m}хв`
  return m > 0 ? `${h}г ${m}хв` : `${h}г`
}

const fmtEUR = (n: number) =>
  '€' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function ProjectReport({ project, members, onClose }: {
  project: Project
  members: TeamMember[]
  onClose: () => void
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [income, setIncome] = useState(0)
  const [expense, setExpense] = useState(0)
  const [loading, setLoading] = useState(true)
  const { toEUR, loading: ratesLoading } = useRates()
  const { width, startResize } = useChatWidth()

  useEffect(() => {
    if (ratesLoading) return
    ;(async () => {
      const { data: tx } = await supabase
        .from('pm_tasks')
        .select('id, title')
        .eq('finance_project_id', project.id)
        .order('created_at')
      const taskIds = (tx ?? []).map(t => t.id)
      const [{ data: ents }, { data: txs }] = await Promise.all([
        taskIds.length > 0
          ? supabase.from('time_entries')
              .select('task_id, team_member_id, duration_seconds')
              .in('task_id', taskIds)
              .not('ended_at', 'is', null)
          : Promise.resolve({ data: [] as EntryRow[] }),
        supabase.from('transactions')
          .select('type, amount, currency, is_planned')
          .eq('project_id', project.id)
          .eq('is_planned', false),
      ])
      setTasks((tx ?? []) as TaskRow[])
      setEntries((ents ?? []) as EntryRow[])
      setIncome((txs ?? []).filter(t => t.type === 'income').reduce((s, t) => s + toEUR(t.amount, t.currency), 0))
      setExpense((txs ?? []).filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0))
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, ratesLoading])

  const memberById = new Map(members.map(m => [m.id, m]))

  // Per task: seconds per member
  const byTask = new Map<string, Map<string, number>>()
  const byMember = new Map<string, number>()
  let totalSeconds = 0
  for (const e of entries) {
    const secs = e.duration_seconds ?? 0
    totalSeconds += secs
    if (!byTask.has(e.task_id)) byTask.set(e.task_id, new Map())
    const tm = byTask.get(e.task_id)!
    tm.set(e.team_member_id, (tm.get(e.team_member_id) ?? 0) + secs)
    byMember.set(e.team_member_id, (byMember.get(e.team_member_id) ?? 0) + secs)
  }

  // Labor cost by hourly rates ($/год → EUR base); fixed-salary members
  // are counted as hours only
  function costOf(memberId: string, seconds: number) {
    const m = memberById.get(memberId)
    if (!m || m.salary_type === 'monthly') return 0
    return toEUR((seconds / 3600) * (m.hourly_rate_usd ?? 0), 'USD')
  }
  let laborCost = 0
  for (const [mid, secs] of byMember) laborCost += costOf(mid, secs)

  const contractSym = CURRENCY_SYMBOL[project.contract_currency ?? 'USD'] ?? '$'
  const sortedTasks = [...tasks].sort((a, b) => {
    const sa = [...(byTask.get(a.id)?.values() ?? [])].reduce((x, y) => x + y, 0)
    const sb = [...(byTask.get(b.id)?.values() ?? [])].reduce((x, y) => x + y, 0)
    return sb - sa
  })

  return (
    <div
      className="fixed right-0 top-0 h-full bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width: Math.max(width, 460) }}
    >
      <ChatResizeHandle onMouseDown={startResize} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 size={15} className="text-teal-500" />
          <p className="text-sm font-semibold text-gray-800">Звіт по проєкту</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Завантаження...</p>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Бюджет (контракт)</p>
              <p className="text-lg font-bold text-gray-900">
                {project.contract_amount ? `${contractSym}${Number(project.contract_amount).toLocaleString('en-US')}` : '—'}
              </p>
            </div>
            <div className="bg-teal-50 rounded-xl p-3">
              <p className="text-[10px] text-teal-500 uppercase tracking-wide mb-0.5">Отримано</p>
              <p className="text-lg font-bold text-teal-600">{fmtEUR(income)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Затрекано</p>
              <p className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                <Clock size={14} className="text-gray-400" />{fmtDur(totalSeconds)}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">робота по рейтах: {fmtEUR(laborCost)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3">
              <p className="text-[10px] text-red-400 uppercase tracking-wide mb-0.5">Витрати (факт)</p>
              <p className="text-lg font-bold text-red-500">{fmtEUR(expense)}</p>
            </div>
          </div>

          {/* Per member */}
          {byMember.size > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">По людях</p>
              <div className="flex flex-col gap-1.5">
                {[...byMember.entries()].sort((a, b) => b[1] - a[1]).map(([mid, secs]) => {
                  const m = memberById.get(mid)
                  const cost = costOf(mid, secs)
                  return (
                    <div key={mid} className="flex items-center gap-2.5 bg-white border border-gray-100 rounded-xl px-3 py-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
                        style={{ backgroundColor: m?.color ?? '#9ca3af' }}
                      >
                        {(m?.name ?? '?').charAt(0)}
                      </div>
                      <span className="text-sm text-gray-800 font-medium truncate">{m?.name ?? 'Невідомо'}</span>
                      <span className="ml-auto text-xs text-gray-500">{fmtDur(secs)}</span>
                      <span className="text-xs font-semibold text-gray-800 w-16 text-right">
                        {m?.salary_type === 'monthly' ? 'фікс' : fmtEUR(cost)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per task */}
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">По тасках</p>
            {sortedTasks.length === 0 && (
              <p className="text-xs text-gray-300 text-center py-6">У проєкті ще немає тасок</p>
            )}
            <div className="flex flex-col gap-1.5">
              {sortedTasks.map(t => {
                const tm = byTask.get(t.id)
                const secs = [...(tm?.values() ?? [])].reduce((x, y) => x + y, 0)
                const cost = [...(tm?.entries() ?? [])].reduce((x, [mid, s]) => x + costOf(mid, s), 0)
                return (
                  <div key={t.id} className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0">{fmtDur(secs)}</span>
                      <span className="text-xs font-semibold text-gray-800 w-14 text-right flex-shrink-0">
                        {secs > 0 && cost > 0 ? fmtEUR(cost) : secs > 0 ? '' : '—'}
                      </span>
                    </div>
                    {tm && tm.size > 0 && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {[...tm.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([mid, s]) => `${memberById.get(mid)?.name ?? '?'} · ${fmtDur(s)}`)
                          .join('  ·  ')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-[10px] text-gray-300">
            Вартість роботи рахується за погодинними рейтами; учасники з фіксованою ЗП показуються
            годинами без вартості. Цей звіт бачите тільки ви.
          </p>
        </div>
      )}
    </div>
  )
}
