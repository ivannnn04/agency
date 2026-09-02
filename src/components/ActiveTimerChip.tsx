'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Timer, Square } from 'lucide-react'

// Global running-timer chip for team headers: shows the member's open time
// entry wherever they are until it's stopped. Project name links to the
// board, task title deep-links straight to that task (?task=...).

interface ActiveEntry {
  entryId: string
  taskId: string
  startedAt: Date
  taskTitle: string
  projectId: string | null
  projectName: string | null
}

function formatElapsed(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ActiveTimerChip({ memberId }: { memberId: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<ActiveEntry | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const check = useCallback(async () => {
    const { data: open } = await supabase
      .from('time_entries')
      .select('id, task_id, started_at')
      .eq('team_member_id', memberId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)

    const row = open?.[0]
    if (!row) { setEntry(null); return }

    const { data: task } = await supabase
      .from('pm_tasks')
      .select('id, title, finance_project_id')
      .eq('id', row.task_id)
      .single()

    let projectName: string | null = null
    if (task?.finance_project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('name')
        .eq('id', task.finance_project_id)
        .single()
      projectName = proj?.name ?? null
    }

    setEntry({
      entryId: row.id,
      taskId: row.task_id,
      startedAt: new Date(row.started_at),
      taskTitle: task?.title ?? 'Задача',
      projectId: task?.finance_project_id ?? null,
      projectName,
    })
  }, [memberId])

  // Initial check + periodic re-check (the timer can start/stop on other pages/tabs)
  useEffect(() => {
    check()
    const iv = setInterval(check, 15000)
    return () => clearInterval(iv)
  }, [check])

  // Second-by-second ticking while running
  useEffect(() => {
    if (!entry) return
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [entry])

  async function stop() {
    if (!entry) return
    const endedAt = new Date()
    const duration = Math.floor((endedAt.getTime() - entry.startedAt.getTime()) / 1000)
    await supabase
      .from('time_entries')
      .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
      .eq('id', entry.entryId)
    setEntry(null)
    setElapsed(0)
  }

  if (!entry) return null

  return (
    <div className="flex items-center gap-2 bg-teal-500/15 border border-teal-500/30 rounded-xl pl-2.5 pr-1.5 py-1.5 min-w-0 max-w-[60vw] md:max-w-md">
      <Timer size={13} className="text-teal-400 flex-shrink-0 animate-pulse" />
      <div className="flex items-center gap-1.5 min-w-0 text-xs">
        {entry.projectId && (
          <>
            <button
              onClick={() => router.push(`/team/board/${entry.projectId}`)}
              className="text-teal-300 hover:text-white font-semibold truncate max-w-[90px] md:max-w-[140px] transition-colors"
              title={`Відкрити проєкт «${entry.projectName ?? ''}»`}
            >
              {entry.projectName ?? 'Проєкт'}
            </button>
            <span className="text-gray-500 flex-shrink-0">/</span>
          </>
        )}
        <button
          onClick={() => entry.projectId
            ? router.push(`/team/board/${entry.projectId}?task=${entry.taskId}`)
            : undefined}
          className="text-gray-200 hover:text-white truncate max-w-[110px] md:max-w-[180px] transition-colors"
          title={`Відкрити задачу «${entry.taskTitle}»`}
        >
          {entry.taskTitle}
        </button>
      </div>
      <span className="font-mono text-xs text-teal-400 flex-shrink-0">{formatElapsed(elapsed)}</span>
      <button
        onClick={stop}
        className="bg-red-500 hover:bg-red-600 text-white p-1 rounded-lg transition-colors flex-shrink-0"
        title="Зупинити таймер"
      >
        <Square size={10} fill="currentColor" />
      </button>
    </div>
  )
}
