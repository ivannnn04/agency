'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ListTree, Play, Plus, Square, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Subtasks of a task: tick them off, rename, delete, and track time on each.
// Time on a subtask is stored on the task itself (marked with the subtask),
// so the task's total, payroll, invoices and the client's hours all include it.
//
// The team board passes its own timer (one per member); on the admin board
// the timer is the admin's own (/api/admin-time), as on the task itself.

interface Subtask { id: string; task_id: string; title: string; done: boolean; position: number }

export interface SubtaskTimer {
  activeSubtaskId: string | null
  elapsed: number
  start: (subtaskId: string) => void
  stop: () => void
}

export const ADMIN_TIME_CHANGED = 'gudrix:admin-time-changed'
export const SUBTASKS_CHANGED = 'gudrix:subtasks-changed'
const MIGRATION_HINT = 'Запусти міграцію supabase/subtasks_migration.sql у Supabase SQL Editor'

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m} хв`
  return m > 0 ? `${h} год ${m} хв` : `${h} год`
}
const clock = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')

export default function TaskSubtasks({ taskId, mode, timer, reloadKey = 0 }: {
  taskId: string
  mode: 'admin' | 'team'
  timer?: SubtaskTimer
  reloadKey?: number
}) {
  const [items, setItems] = useState<Subtask[] | null>(null)
  const [teamTime, setTeamTime] = useState<Record<string, number>>({})
  const [myTime, setMyTime] = useState<Record<string, number>>({})
  // Admin board: the admin's own running timer, when it is on a subtask of this task
  const [adminRun, setAdminRun] = useState<{ subtaskId: string; startedAt: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase.from('pm_subtasks').select('*').eq('task_id', taskId).order('position').order('created_at')
      if (!alive) return
      if (err) { setItems([]); setError(/pm_subtasks|schema cache|does not exist/i.test(err.message) ? MIGRATION_HINT : err.message); return }
      setItems((data ?? []) as Subtask[])
      const { data: entries } = await supabase
        .from('time_entries').select('subtask_id, duration_seconds').eq('task_id', taskId).not('subtask_id', 'is', null).not('ended_at', 'is', null)
      const sums: Record<string, number> = {}
      for (const e of (entries ?? []) as { subtask_id: string; duration_seconds: number | null }[]) sums[e.subtask_id] = (sums[e.subtask_id] ?? 0) + (e.duration_seconds ?? 0)
      if (alive) setTeamTime(sums)
      if (mode === 'admin') {
        const r = await fetch(`/api/admin-time?task=${taskId}`).catch(() => null)
        const d = r?.ok ? await r.json().catch(() => null) : null
        if (!alive || !d) return
        setMyTime(d.by_subtask ?? {})
        setAdminRun(d.running?.subtask_id ? { subtaskId: d.running.subtask_id, startedAt: new Date(d.running.started_at).getTime() } : null)
      }
    })()
    return () => { alive = false }
  }, [taskId, mode, nonce, reloadKey])

  // The admin's timer on the task itself also refreshes this list
  useEffect(() => {
    if (mode !== 'admin') return
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener(ADMIN_TIME_CHANGED, refresh)
    return () => window.removeEventListener(ADMIN_TIME_CHANGED, refresh)
  }, [mode])

  useEffect(() => {
    if (!adminRun) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [adminRun])


  const announce = () => window.dispatchEvent(new CustomEvent(SUBTASKS_CHANGED, { detail: { taskId } }))

  async function add() {
    const title = draft.trim()
    if (!title || !items) return
    setError('')
    const position = items.length ? Math.max(...items.map(i => i.position)) + 1 : 0
    const { data, error: err } = await supabase.from('pm_subtasks').insert({ task_id: taskId, title: title.slice(0, 300), position }).select().single()
    if (err || !data) { setError(err && /pm_subtasks|schema cache/i.test(err.message) ? MIGRATION_HINT : err?.message ?? 'Не вдалося додати'); return }
    setItems(prev => [...(prev ?? []), data as Subtask])
    setDraft('')
    announce()
    inputRef.current?.focus()
  }

  async function update(id: string, patch: Partial<Pick<Subtask, 'title' | 'done'>>) {
    setItems(prev => prev?.map(i => (i.id === id ? { ...i, ...patch } : i)) ?? prev)
    const { error: err } = await supabase.from('pm_subtasks').update(patch).eq('id', id)
    if (err) setError(err.message)
    announce()
  }

  async function remove(s: Subtask) {
    const tracked = (teamTime[s.id] ?? 0) + (myTime[s.id] ?? 0)
    if (!window.confirm(tracked > 0 ? `Видалити «${s.title}»? Затрекані ${fmt(tracked)} лишаться на задачі.` : `Видалити «${s.title}»?`)) return
    if (timer?.activeSubtaskId === s.id) timer.stop()
    if (adminRun?.subtaskId === s.id) await adminTimer('stop', s.id)
    setItems(prev => prev?.filter(i => i.id !== s.id) ?? prev)
    const { error: err } = await supabase.from('pm_subtasks').delete().eq('id', s.id)
    if (err) setError(err.message)
    announce()
  }

  async function adminTimer(action: 'start' | 'stop', subtaskId: string) {
    setError('')
    const res = await fetch('/api/admin-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, action, subtaskId }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return }
    // Both this list and the task's own timer reload from the server
    window.dispatchEvent(new Event(ADMIN_TIME_CHANGED))
  }

  if (items === null) return null
  const done = items.filter(i => i.done).length
  const runningId = mode === 'admin' ? adminRun?.subtaskId ?? null : timer?.activeSubtaskId ?? null
  const runningFor = mode === 'admin' ? (adminRun ? Math.max(0, Math.round((now - adminRun.startedAt) / 1000)) : 0) : timer?.elapsed ?? 0
  const canTrack = mode === 'admin' || !!timer

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <ListTree size={13} className="text-gray-400" />
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Сабтаски</p>
        {items.length > 0 && <span className="text-xs text-gray-400 tabular-nums">{done}/{items.length}</span>}
        {items.length > 0 && (
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden ml-1 max-w-[140px]">
            <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="flex flex-col">
        {items.map(s => {
          const running = runningId === s.id
          const total = (teamTime[s.id] ?? 0) + (myTime[s.id] ?? 0) + (running ? runningFor : 0)
          return (
            <div key={s.id} className="group flex items-center gap-2 py-1 -mx-1.5 px-1.5 rounded-lg hover:bg-gray-50">
              <button
                onClick={() => update(s.id, { done: !s.done })}
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${s.done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300 hover:border-gray-900'}`}
                title={s.done ? 'Позначити невиконаною' : 'Позначити виконаною'}
                aria-label={s.done ? 'Позначити невиконаною' : 'Позначити виконаною'}
              >
                {s.done && <Check size={11} strokeWidth={3} />}
              </button>
              {editing === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.title}
                  onBlur={e => { setEditing(null); const v = e.target.value.trim(); if (v && v !== s.title) update(s.id, { title: v.slice(0, 300) }) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                  className="flex-1 min-w-0 text-sm text-gray-800 bg-white border border-gray-200 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              ) : (
                <span onClick={() => setEditing(s.id)} className={`flex-1 min-w-0 text-sm cursor-text truncate ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`} title={s.title}>
                  {s.title}
                </span>
              )}
              {total > 0 && <span className={`text-xs tabular-nums flex-shrink-0 ${running ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{running ? clock(runningFor) : fmt(total)}</span>}
              {canTrack && (running ? (
                <button
                  onClick={() => (mode === 'admin' ? adminTimer('stop', s.id) : timer?.stop())}
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                  title="Зупинити таймер" aria-label="Зупинити таймер"
                >
                  <Square size={9} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => (mode === 'admin' ? adminTimer('start', s.id) : timer?.start(s.id))}
                  className="flex items-center justify-center w-6 h-6 rounded-full text-gray-400 hover:text-white hover:bg-gray-900 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-all"
                  title={mode === 'admin' ? 'Трекати мій час на сабтаску' : 'Трекати час на сабтаску'} aria-label="Почати таймер на сабтаску"
                >
                  <Play size={10} fill="currentColor" />
                </button>
              ))}
              <button onClick={() => remove(s)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Видалити сабтаску" aria-label="Видалити сабтаску">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 mt-1">
        <Plus size={13} className="text-gray-300 flex-shrink-0" />
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Додати сабтаску… (Enter)"
          className="flex-1 text-sm bg-transparent placeholder-gray-300 focus:outline-none py-1"
          aria-label="Нова сабтаска"
        />
      </div>
      {mode === 'admin' && items.length > 0 && <p className="text-[10px] text-gray-400 mt-1">Таймер на сабтасці — твій час. Час команди теж видно тут.</p>}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ── Board cards: "2/5" subtasks done ─────────────────────────────────────────
// One query per board (not per card): the board loads the counts into a small
// shared store, each card's chip reads its own entry.

type Counts = Record<string, { done: number; total: number }>
let counts: Counts = {}
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useSubtaskCounts(taskIds: string[]) {
  const key = [...taskIds].sort().join(',')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener(SUBTASKS_CHANGED, refresh)
    return () => window.removeEventListener(SUBTASKS_CHANGED, refresh)
  }, [])
  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) return
    let alive = true
    supabase.from('pm_subtasks').select('task_id, done').in('task_id', ids).then(({ data, error }) => {
      if (!alive || error) return
      const next: Counts = {}
      for (const r of (data ?? []) as { task_id: string; done: boolean }[]) {
        const c = next[r.task_id] ?? { done: 0, total: 0 }
        c.total++
        if (r.done) c.done++
        next[r.task_id] = c
      }
      counts = next
      listeners.forEach(l => l())
    })
    return () => { alive = false }
  }, [key, nonce])
}

export function SubtaskChip({ taskId }: { taskId: string }) {
  const c = useSyncExternalStore(subscribe, () => counts[taskId], () => undefined)
  if (!c || c.total === 0) return null
  const all = c.done === c.total
  return (
    <span className={`flex items-center gap-0.5 text-[10px] tabular-nums ${all ? 'text-emerald-600' : 'text-gray-400'}`} title={`Сабтаски: ${c.done} з ${c.total}`}>
      <ListTree size={10} /> {c.done}/{c.total}
    </span>
  )
}
