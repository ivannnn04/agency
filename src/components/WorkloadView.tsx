'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Clock, AlertTriangle, UserRound } from 'lucide-react'

// Workload board: one column per team member with their open tasks and
// estimates. The running offset shows when a newly assigned task would
// realistically start. Visible to the admin and to empowered team members.

interface WTask {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  column_id: string | null
  finance_project_id: string | null
  estimate_hours: number | null
  team_member_id: string | null
  created_at: string
}

interface Member { id: string; name: string; color: string; role: string }

const DONE_COLUMN = /done|заверш|готово|complete/i

function fmtH(h: number) {
  const rounded = Math.round(h * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}г`
}

export default function WorkloadView({ canEdit }: { canEdit: boolean }) {
  const [members, setMembers] = useState<Member[]>([])
  const [tasks, setTasks] = useState<WTask[]>([])
  const [assignees, setAssignees] = useState<Record<string, string[]>>({}) // task_id -> member ids
  const [projNames, setProjNames] = useState<Record<string, string>>({})
  const [colInfo, setColInfo] = useState<Record<string, { name: string; color: string }>>({})
  const [trackedByTask, setTrackedByTask] = useState<Record<string, number>>({}) // seconds
  const [loading, setLoading] = useState(true)
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const load = useCallback(async () => {
    const [{ data: mems }, { data: tx }, { data: asg }, { data: projs }] = await Promise.all([
      supabase.from('team_members').select('id, name, color, role').order('name'),
      supabase.from('pm_tasks').select('id, title, status, priority, due_date, column_id, finance_project_id, estimate_hours, team_member_id, created_at'),
      supabase.from('task_assignees').select('task_id, team_member_id'),
      supabase.from('projects').select('id, name'),
    ])
    setMembers((mems ?? []) as Member[])

    const open = ((tx ?? []) as WTask[]).filter(t => (t.status ?? '') !== 'completed')

    // Column names — to drop tasks sitting in done-like columns
    const colIds = [...new Set(open.map(t => t.column_id).filter((x): x is string => !!x))]
    const { data: cols } = colIds.length > 0
      ? await supabase.from('pm_columns').select('id, name, color').in('id', colIds)
      : { data: [] }
    const cmap: Record<string, { name: string; color: string }> = {}
    for (const c of cols ?? []) cmap[c.id] = { name: c.name, color: c.color }
    setColInfo(cmap)

    const active = open.filter(t => !(t.column_id && cmap[t.column_id] && DONE_COLUMN.test(cmap[t.column_id].name)))
    setTasks(active)

    const amap: Record<string, string[]> = {}
    for (const r of (asg ?? []) as { task_id: string; team_member_id: string }[]) {
      if (!amap[r.task_id]) amap[r.task_id] = []
      amap[r.task_id].push(r.team_member_id)
    }
    setAssignees(amap)

    const pmap: Record<string, string> = {}
    for (const p of projs ?? []) pmap[p.id] = p.name
    setProjNames(pmap)

    // Tracked time per open task — the queue counts remaining, not full estimates
    const taskIds = active.map(t => t.id)
    if (taskIds.length > 0) {
      const { data: entries } = await supabase
        .from('time_entries')
        .select('task_id, duration_seconds')
        .in('task_id', taskIds)
        .not('ended_at', 'is', null)
      const sums: Record<string, number> = {}
      for (const e of entries ?? []) sums[e.task_id] = (sums[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
      setTrackedByTask(sums)
    } else {
      setTrackedByTask({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function taskMembers(t: WTask): string[] {
    const ids = assignees[t.id] ?? []
    if (ids.length > 0) return ids
    return t.team_member_id ? [t.team_member_id] : []
  }

  // Hours still needed on a task: estimate minus already-tracked time
  function remainingHours(t: WTask): number | null {
    if (t.estimate_hours == null) return null
    const tracked = (trackedByTask[t.id] ?? 0) / 3600
    return Math.max(0, t.estimate_hours - tracked)
  }

  function sortTasks(list: WTask[]): WTask[] {
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return a.created_at.localeCompare(b.created_at)
    })
  }

  async function saveEstimate(t: WTask) {
    setEditingTask(null)
    const v = editValue.trim() === '' ? null : Number(editValue)
    if (v !== null && (isNaN(v) || v < 0)) return
    if (v === t.estimate_hours) return
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, estimate_hours: v } : x))
    await supabase.from('pm_tasks').update({ estimate_hours: v }).eq('id', t.id)
  }

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">Завантаження...</p>

  const unassigned = sortTasks(tasks.filter(t => taskMembers(t).length === 0))

  return (
    <div className="flex gap-4 overflow-x-auto items-start pb-4">
      {members.map(m => {
        const myTasks = sortTasks(tasks.filter(t => taskMembers(t).includes(m.id)))
        const queueHours = myTasks.reduce((s, t) => s + (remainingHours(t) ?? 0), 0)
        const noEstimate = myTasks.filter(t => t.estimate_hours == null).length
        let offset = 0

        return (
          <div key={m.id} className="flex-shrink-0 w-[280px] bg-white rounded-2xl border border-gray-100 shadow-sm">
            {/* Member header */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ backgroundColor: m.color || '#14b8a6' }}
                >
                  {m.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{m.name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{m.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                  <Clock size={10} /> у черзі {fmtH(queueHours)}
                </span>
                <span className="text-[10px] text-gray-400">{myTasks.length} задач</span>
                {noEstimate > 0 && (
                  <span
                    className="flex items-center gap-1 text-[10px] text-amber-600"
                    title={`${noEstimate} задач без естімейту — не враховані в черзі`}
                  >
                    <AlertTriangle size={10} /> {noEstimate}
                  </span>
                )}
              </div>
            </div>

            {/* Task queue */}
            <div className="p-2.5 flex flex-col gap-2 max-h-[62vh] overflow-y-auto">
              {myTasks.length === 0 && (
                <p className="text-xs text-gray-300 text-center py-6">Немає активних задач 🎉</p>
              )}
              {myTasks.map(t => {
                const rem = remainingHours(t)
                const startAfter = offset
                offset += rem ?? 0
                const col = t.column_id ? colInfo[t.column_id] : null
                const overdue = t.due_date && new Date(t.due_date) < new Date()
                return (
                  <div key={t.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                    <p className="text-xs font-medium text-gray-900 leading-snug break-words">{t.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                      {t.finance_project_id ? (projNames[t.finance_project_id] ?? '') : 'Без проєкту'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {col && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: col.color + '22', color: col.color }}
                        >
                          {col.name}
                        </span>
                      )}
                      {t.due_date && (
                        <span className={`text-[9px] ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                          до {new Date(t.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      {canEdit && editingTask === t.id ? (
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEstimate(t)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEstimate(t)
                            if (e.key === 'Escape') setEditingTask(null)
                          }}
                          className="w-16 text-[11px] border border-teal-300 rounded-lg px-1.5 py-0.5 bg-white focus:outline-none"
                          placeholder="год"
                        />
                      ) : (
                        <button
                          disabled={!canEdit}
                          onClick={() => {
                            if (!canEdit) return
                            setEditingTask(t.id)
                            setEditValue(t.estimate_hours != null ? String(t.estimate_hours) : '')
                          }}
                          className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-lg transition-colors ${
                            t.estimate_hours == null
                              ? 'text-amber-600 bg-amber-50' + (canEdit ? ' hover:bg-amber-100' : '')
                              : 'text-gray-700 bg-gray-100' + (canEdit ? ' hover:bg-gray-200' : '')
                          }`}
                          title={canEdit ? 'Клікни, щоб змінити естімейт' : undefined}
                        >
                          {t.estimate_hours == null ? 'без естімейту' : `≈ ${fmtH(rem ?? 0)}`}
                        </button>
                      )}
                      <span className="text-[9px] text-gray-400">
                        {startAfter <= 0 ? 'в роботі зараз' : `старт через ~${fmtH(startAfter)}`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Unassigned open tasks — candidates to hand out */}
      {unassigned.length > 0 && (
        <div className="flex-shrink-0 w-[280px] bg-white rounded-2xl border border-dashed border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <UserRound size={14} className="text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-500">Не призначено</p>
              <p className="text-[10px] text-gray-400">{unassigned.length} задач</p>
            </div>
          </div>
          <div className="p-2.5 flex flex-col gap-2 max-h-[62vh] overflow-y-auto">
            {unassigned.map(t => (
              <div key={t.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                <p className="text-xs font-medium text-gray-700 leading-snug break-words">{t.title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                  {t.finance_project_id ? (projNames[t.finance_project_id] ?? '') : 'Без проєкту'}
                </p>
                {t.estimate_hours != null && (
                  <p className="text-[10px] text-gray-500 mt-1">≈ {fmtH(t.estimate_hours)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
