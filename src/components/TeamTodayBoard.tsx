'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useOnlineUsers } from '@/lib/presence'
import { Play, Clock } from 'lucide-react'

// Live "what is the team doing today" board for the CEO dashboard:
// one column per member — the timer they are running RIGHT NOW (live
// elapsed), plus everything they tracked today. Polls every 15s.

interface Member { id: string; name: string; color: string | null; avatar_url?: string | null }
interface Entry {
  team_member_id: string
  task_id: string
  duration_seconds: number | null
  started_at: string
  ended_at: string | null
}

function fmtDur(totalSec: number) {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h === 0) return `${m}хв`
  return m > 0 ? `${h}г ${m}хв` : `${h}г`
}

export default function TeamTodayBoard() {
  const [members, setMembers] = useState<Member[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [taskInfo, setTaskInfo] = useState<Record<string, { title: string; project: string | null }>>({})
  const [now, setNow] = useState(Date.now())
  const online = useOnlineUsers()

  const load = useCallback(async () => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    // Today's entries + anything still running (even if started before midnight)
    const [mems, todays, running] = await Promise.all([
      supabase.from('team_members').select('*').order('name'),
      supabase.from('time_entries')
        .select('team_member_id, task_id, duration_seconds, started_at, ended_at')
        .gte('started_at', dayStart.toISOString()),
      supabase.from('time_entries')
        .select('team_member_id, task_id, duration_seconds, started_at, ended_at')
        .is('ended_at', null),
    ])
    setMembers((mems.data ?? []) as Member[])

    const seen = new Set<string>()
    const all: Entry[] = []
    for (const e of [...(todays.data ?? []), ...(running.data ?? [])] as (Entry & { id?: string })[]) {
      const k = `${e.team_member_id}|${e.task_id}|${e.started_at}`
      if (seen.has(k)) continue
      seen.add(k)
      all.push(e)
    }
    setEntries(all)

    const taskIds = [...new Set(all.map(e => e.task_id))]
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from('pm_tasks')
        .select('id, title, finance_project_id')
        .in('id', taskIds)
      const projIds = [...new Set((tasks ?? []).map(t => t.finance_project_id).filter(Boolean))]
      const projName: Record<string, string> = {}
      if (projIds.length > 0) {
        const { data: projs } = await supabase.from('projects').select('id, name').in('id', projIds)
        for (const p of projs ?? []) projName[p.id] = p.name
      }
      const info: Record<string, { title: string; project: string | null }> = {}
      for (const t of tasks ?? []) {
        info[t.id] = { title: t.title, project: t.finance_project_id ? projName[t.finance_project_id] ?? null : null }
      }
      setTaskInfo(info)
    }
  }, [])

  useEffect(() => {
    load()
    const poll = setInterval(load, 15000)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900">Що команда робить сьогодні</p>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-pulse" /> лайв, оновлюється саме
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {members.map(m => {
          const mine = entries.filter(e => e.team_member_id === m.id)
          const active = mine.find(e => !e.ended_at)
          const done = mine.filter(e => e.ended_at)
          // sum today's finished time + live elapsed of the running one
          const doneSec = done.reduce((s, e) => s + (e.duration_seconds ?? 0), 0)
          const liveSec = active ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000)) : 0
          const isOnline = !!online[`team-${m.id}`]
          // today's finished work grouped by task
          const byTask: Record<string, number> = {}
          for (const e of done) byTask[e.task_id] = (byTask[e.task_id] ?? 0) + (e.duration_seconds ?? 0)

          return (
            <div key={m.id} className="flex-shrink-0 w-60 bg-gray-50/60 border border-gray-100 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt={m.name} className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: m.color || '#14b8a6' }}
                  >
                    {m.name.charAt(0)}
                  </span>
                )}
                <span className="text-sm font-medium text-gray-900 truncate flex-1">{m.name}</span>
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-teal-500' : 'bg-gray-200'}`}
                  title={isOnline ? 'Онлайн' : 'Офлайн'}
                />
              </div>

              {active ? (
                <div className="bg-white border border-red-100 rounded-lg p-2.5 mb-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold text-red-500 uppercase tracking-wide mb-1">
                    <Play size={9} fill="currentColor" className="animate-pulse" /> зараз трекає · {fmtDur(liveSec)}
                  </p>
                  <p className="text-xs text-gray-800 leading-snug">{taskInfo[active.task_id]?.title ?? 'Задача'}</p>
                  {taskInfo[active.task_id]?.project && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{taskInfo[active.task_id].project}</p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-300 mb-2">{isOnline ? 'Зараз нічого не трекає' : 'Не трекає'}</p>
              )}

              {Object.keys(byTask).length > 0 && (
                <div className="flex flex-col gap-1">
                  {Object.entries(byTask).map(([taskId, sec]) => (
                    <div key={taskId} className="flex items-start justify-between gap-2 text-[11px]">
                      <span className="text-gray-600 leading-snug min-w-0">
                        {taskInfo[taskId]?.title ?? 'Задача'}
                        {taskInfo[taskId]?.project && <span className="text-gray-300"> · {taskInfo[taskId].project}</span>}
                      </span>
                      <span className="text-gray-400 whitespace-nowrap">{fmtDur(sec)}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1 text-[11px] text-gray-500 font-medium mt-2.5 pt-2 border-t border-gray-100">
                <Clock size={10} /> Сьогодні: {fmtDur(doneSec + liveSec)}
              </p>
            </div>
          )
        })}
        {members.length === 0 && <p className="text-xs text-gray-300 py-4">Немає учасників команди</p>}
      </div>
    </div>
  )
}
