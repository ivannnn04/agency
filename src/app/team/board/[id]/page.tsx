'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { PMColumn, PMTask } from '@/types/pm'
import {
  ArrowLeft, LogOut, Plus, Flag, Calendar, User, Play, Square, Timer,
  BarChart2, X, Trash2, Clock,
} from 'lucide-react'
import TeamNotificationBell from '@/components/TeamNotificationBell'
import GanttView from '@/components/GanttView'

interface Project {
  id: string
  name: string
  color?: string | null
}

interface ActiveTimer {
  entryId: string
  taskId: string
  startedAt: Date
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#9CA3AF',
  medium: '#F59E0B',
  high: '#EF4444',
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

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return `${seconds}с`
  if (h === 0) return `${m}хв`
  return m > 0 ? `${h}г ${m}хв` : `${h}г`
}

export default function TeamBoardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [member, setMember] = useState<TeamMember | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [columns, setColumns] = useState<PMColumn[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [timeByTask, setTimeByTask] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'gantt'>('board')

  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const [selectedTask, setSelectedTask] = useState<PMTask | null>(null)
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  useEffect(() => {
    if (id) fetchAll()
  }, [id])

  // Elapsed timer counter
  useEffect(() => {
    if (!activeTimer) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeTimer.startedAt.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [activeTimer])

  async function fetchAll() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/team/login'); return }

    const { data: mem } = await supabase
      .from('team_members').select('*').eq('supabase_user_id', user.id).single()
    if (!mem) { router.replace('/team/login'); return }
    setMember(mem)

    const [{ data: proj }, { data: cols }, { data: tx }] = await Promise.all([
      supabase.from('projects').select('id, name, color').eq('id', id).single(),
      supabase.from('pm_columns').select('*').eq('project_id', id).order('position'),
      supabase.from('pm_tasks').select('*').eq('finance_project_id', id).order('created_at'),
    ])

    if (proj) setProject(proj)
    if (cols) setColumns(cols)
    if (tx) {
      setTasks(tx)
      // Total tracked time per task
      const taskIds = tx.map(t => t.id)
      if (taskIds.length > 0) {
        const { data: entries } = await supabase
          .from('time_entries')
          .select('task_id, duration_seconds')
          .in('task_id', taskIds)
          .not('ended_at', 'is', null)
        const sums: Record<string, number> = {}
        for (const e of entries ?? []) {
          sums[e.task_id] = (sums[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
        }
        setTimeByTask(sums)
      }
    }

    // Restore any open timer for this member
    const { data: openEntry } = await supabase
      .from('time_entries')
      .select('id, task_id, started_at')
      .eq('team_member_id', mem.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (openEntry) {
      setActiveTimer({
        entryId: openEntry.id,
        taskId: openEntry.task_id,
        startedAt: new Date(openEntry.started_at),
      })
      setElapsed(Math.floor((Date.now() - new Date(openEntry.started_at).getTime()) / 1000))
    }

    setLoading(false)
  }

  async function startTimer(taskId: string) {
    if (activeTimer) await stopTimer()

    const { data } = await supabase
      .from('time_entries')
      .insert({
        task_id: taskId,
        team_member_id: member!.id,
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (data) {
      setActiveTimer({ entryId: data.id, taskId, startedAt: new Date(data.started_at) })
    }
    setElapsed(0)
  }

  async function stopTimer() {
    if (!activeTimer) return
    const endedAt = new Date()
    const duration = Math.floor((endedAt.getTime() - activeTimer.startedAt.getTime()) / 1000)
    await supabase
      .from('time_entries')
      .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
      .eq('id', activeTimer.entryId)
    setTimeByTask(prev => ({
      ...prev,
      [activeTimer.taskId]: (prev[activeTimer.taskId] ?? 0) + duration,
    }))
    setActiveTimer(null)
    setElapsed(0)
  }

  async function createTask(columnId: string) {
    if (!newTaskTitle.trim() || !member) return
    setSaving(true)

    const res = await fetch('/api/team/create-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        finance_project_id: id,
        column_id: columnId,
        team_member_id: member.id,
        created_by: member.name,
        project_name: project?.name ?? '',
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) return

    setTasks(prev => [...prev, json.task])
    setNewTaskTitle('')
    setAddingInColumn(null)
  }

  async function moveTask(taskId: string, toColumnId: string) {
    await supabase.from('pm_tasks').update({ column_id: toColumnId }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, column_id: toColumnId } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, column_id: toColumnId } : prev)
  }

  async function updateTask(taskId: string, patch: Partial<PMTask>) {
    await supabase.from('pm_tasks').update(patch).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...patch } : prev)
  }

  async function updateTaskDates(taskId: string, patch: { start_date?: string | null; due_date?: string | null }) {
    await updateTask(taskId, patch)
  }

  async function handleLogout() {
    if (activeTimer) await stopTimer()
    await supabase.auth.signOut()
    router.replace('/team/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Завантаження...</p>
    </div>
  )

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#0f1117] text-white px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => router.push('/team/dashboard')}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={15} /> Назад
        </button>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <h1 className="text-sm font-semibold truncate">{project?.name}</h1>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5 ml-2">
          <button
            onClick={() => setView('board')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Борда
          </button>
          <button
            onClick={() => setView('gantt')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'gantt' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Гант
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => router.push('/team/reports')}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-xs"
            title="Звіт по годинах"
          >
            <BarChart2 size={14} /> Звіт
          </button>
          {member && <TeamNotificationBell memberId={member.id} />}
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded"
            title="Вийти"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {view === 'board' ? (
          <div className="flex gap-4 p-5 overflow-x-auto flex-1 items-start">
            {columns.map(col => {
              const colTasks = tasks.filter(t => t.column_id === col.id)
              return (
                <div
                  key={col.id}
                  className={`flex-shrink-0 w-[280px] flex flex-col rounded-xl transition-colors ${dragOverCol === col.id ? 'bg-teal-50/70 ring-2 ring-teal-300' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(col.id) }}
                  onDragLeave={() => setDragOverCol(prev => prev === col.id ? null : prev)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOverCol(null)
                    const taskId = e.dataTransfer.getData('text/plain')
                    if (taskId) moveTask(taskId, col.id)
                  }}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-1 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                      <span className="text-xs font-bold tracking-wide uppercase" style={{ color: col.color }}>
                        {col.name}
                      </span>
                      <span className="text-xs text-gray-400 font-medium">{colTasks.length}</span>
                    </div>
                    <button
                      onClick={() => { setAddingInColumn(col.id); setNewTaskTitle('') }}
                      className="text-gray-400 hover:text-gray-600 p-1 rounded"
                      title="Додати задачу"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Tasks */}
                  <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-200px)] min-h-[40px]">
                    {colTasks.map(task => {
                      const isThisTaskActive = activeTimer?.taskId === task.id
                      const otherTaskActive = activeTimer && activeTimer.taskId !== task.id
                      const isOverdue = task.due_date && new Date(task.due_date) < new Date()
                      const tracked = (timeByTask[task.id] ?? 0) + (isThisTaskActive ? elapsed : 0)
                      const isMine = task.team_member_id === member?.id

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData('text/plain', task.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={() => setSelectedTask(task)}
                          className={`bg-white rounded-xl border p-3.5 hover:shadow-sm transition-all cursor-pointer active:cursor-grabbing select-none ${
                            isMine ? 'border-teal-300 ring-1 ring-teal-200' : 'border-gray-100 hover:border-gray-300'
                          }`}
                        >
                          {/* "Assigned to you" badge */}
                          {isMine && (
                            <div className="flex items-center gap-1.5 mb-2">
                              <div
                                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                                style={{ backgroundColor: member?.color ?? '#14b8a6' }}
                              >
                                {member?.name.charAt(0)}
                              </div>
                              <span className="text-[10px] font-semibold text-teal-600 uppercase tracking-wide">
                                Призначено вам
                              </span>
                            </div>
                          )}

                          <p className="text-sm text-gray-800 leading-snug mb-3">{task.title}</p>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {/* Assignee circle */}
                              {isMine ? (
                                <div
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
                                  style={{ backgroundColor: member?.color ?? '#14b8a6' }}
                                  title={`Призначено: ${member?.name}`}
                                >
                                  {member?.name.charAt(0)}
                                </div>
                              ) : task.team_member_id ? (
                                <div
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0 bg-gray-400"
                                  title="Призначено іншому"
                                >
                                  <User size={10} />
                                </div>
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center" title="Не призначено">
                                  <User size={10} className="text-gray-400" />
                                </div>
                              )}

                              {/* Due date */}
                              {task.due_date && (
                                <span className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                                  <Calendar size={11} />
                                  {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                                </span>
                              )}

                              {/* Priority */}
                              {task.priority && (
                                <Flag size={11} style={{ color: PRIORITY_COLOR[task.priority] ?? '#9CA3AF' }} />
                              )}

                              {/* Tracked time */}
                              {tracked > 0 && (
                                <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                                  <Clock size={10} />
                                  {formatHours(tracked)}
                                </span>
                              )}
                            </div>

                            {/* Timer button */}
                            {isThisTaskActive ? (
                              <button
                                onClick={e => { e.stopPropagation(); stopTimer() }}
                                className="flex items-center gap-1 text-[11px] font-mono text-red-500 hover:text-red-600 transition-colors"
                                title="Зупинити таймер"
                              >
                                <Square size={11} className="fill-red-500" />
                                {formatElapsed(elapsed)}
                              </button>
                            ) : otherTaskActive ? (
                              <button
                                onClick={e => e.stopPropagation()}
                                className="p-1 text-gray-200 cursor-not-allowed"
                                disabled
                                title="Інший таймер активний"
                              >
                                <Play size={12} />
                              </button>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); startTimer(task.id) }}
                                className="p-1 text-gray-300 hover:text-teal-500 transition-colors"
                                title="Почати таймер"
                              >
                                <Play size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Inline add task form */}
                    {addingInColumn === col.id ? (
                      <div className="bg-white rounded-xl border-2 border-gray-200 p-3 shadow-sm">
                        <input
                          autoFocus
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') createTask(col.id)
                            if (e.key === 'Escape') { setAddingInColumn(null); setNewTaskTitle('') }
                          }}
                          placeholder="Назва задачі..."
                          className="w-full text-sm focus:outline-none mb-2"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => createTask(col.id)}
                            disabled={!newTaskTitle.trim() || saving}
                            className="text-xs bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg transition-colors"
                          >
                            {saving ? 'Збереження...' : 'Зберегти'}
                          </button>
                          <button
                            onClick={() => { setAddingInColumn(null); setNewTaskTitle('') }}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            Скасувати
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingInColumn(col.id); setNewTaskTitle('') }}
                        className="w-full flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Plus size={14} style={{ color: col.color }} />
                        <span>Додати задачу</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {columns.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-20 text-gray-400">
                <p className="text-sm">Немає колонок у цьому проєкті</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <GanttView tasks={tasks} onUpdate={updateTaskDates} />
          </div>
        )}

        {/* Task detail side panel */}
        {selectedTask && (
          <TaskPanel
            task={selectedTask}
            columns={columns}
            member={member}
            trackedSeconds={(timeByTask[selectedTask.id] ?? 0) + (activeTimer?.taskId === selectedTask.id ? elapsed : 0)}
            isTimerActive={activeTimer?.taskId === selectedTask.id}
            otherTimerActive={!!activeTimer && activeTimer.taskId !== selectedTask.id}
            elapsed={elapsed}
            onStartTimer={() => startTimer(selectedTask.id)}
            onStopTimer={stopTimer}
            onClose={() => setSelectedTask(null)}
            onUpdate={patch => updateTask(selectedTask.id, patch)}
            onMove={colId => moveTask(selectedTask.id, colId)}
          />
        )}
      </div>

      {/* Active timer indicator */}
      {activeTimer && !selectedTask && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 z-30">
          <Timer size={14} className="text-teal-400" />
          <span className="text-xs text-gray-300">
            {tasks.find(t => t.id === activeTimer.taskId)?.title ?? 'Задача'}
          </span>
          <span className="font-mono text-sm text-teal-400">{formatElapsed(elapsed)}</span>
          <button
            onClick={stopTimer}
            className="ml-1 text-red-400 hover:text-red-300 transition-colors"
          >
            <Square size={13} className="fill-red-400" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Task detail side panel ──────────────────────────────────────────────────────

function TaskPanel({
  task, columns, member, trackedSeconds, isTimerActive, otherTimerActive, elapsed,
  onStartTimer, onStopTimer, onClose, onUpdate, onMove,
}: {
  task: PMTask
  columns: PMColumn[]
  member: TeamMember | null
  trackedSeconds: number
  isTimerActive: boolean
  otherTimerActive: boolean
  elapsed: number
  onStartTimer: () => void
  onStopTimer: () => void
  onClose: () => void
  onUpdate: (patch: Partial<PMTask>) => void
  onMove: (colId: string) => void
}) {
  const isMine = task.team_member_id === member?.id
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description ?? '')
  const [estimate, setEstimate] = useState(task.estimate_hours != null ? String(task.estimate_hours) : '')

  useEffect(() => {
    setTitle(task.title)
    setDesc(task.description ?? '')
    setEstimate(task.estimate_hours != null ? String(task.estimate_hours) : '')
  }, [task.id])

  function saveTitle() {
    const t = title.trim()
    if (t && t !== task.title) onUpdate({ title: t })
  }
  function saveDesc() {
    const d = desc.trim()
    if (d !== (task.description ?? '')) onUpdate({ description: d || null })
  }
  function saveEstimate() {
    const v = estimate.trim() === '' ? null : Number(estimate)
    if (v !== task.estimate_hours && !(v !== null && isNaN(v))) {
      onUpdate({ estimate_hours: v })
    }
  }

  const currentCol = columns.find(c => c.id === task.column_id)
  const estimateSec = task.estimate_hours != null ? task.estimate_hours * 3600 : null
  const overEstimate = estimateSec !== null && trackedSeconds > estimateSec

  return (
    <div className="w-[400px] min-w-[400px] border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        {currentCol && (
          <span
            style={{ backgroundColor: currentCol.color + '22', color: currentCol.color }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide"
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentCol.color }} />
            {currentCol.name}
          </span>
        )}
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="px-5 pt-4 pb-2">
          <textarea
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            rows={2}
            className="w-full text-lg font-semibold text-gray-900 resize-none focus:outline-none leading-snug placeholder-gray-300"
            placeholder="Назва задачі"
          />
        </div>

        {/* Timer block */}
        <div className="mx-5 mb-4 p-4 bg-gray-50 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Затрекано</p>
              <p className={`text-xl font-bold font-mono ${overEstimate ? 'text-red-500' : 'text-gray-900'}`}>
                {formatHours(trackedSeconds)}
              </p>
              {estimateSec !== null && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  з {formatHours(estimateSec)} за естімейтом
                </p>
              )}
            </div>
            {isTimerActive ? (
              <button
                onClick={onStopTimer}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                <Square size={13} className="fill-white" />
                {formatElapsed(elapsed)}
              </button>
            ) : (
              <button
                onClick={onStartTimer}
                disabled={otherTimerActive}
                className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                title={otherTimerActive ? 'Спочатку зупиніть інший таймер' : 'Почати трекати час'}
              >
                <Play size={13} className="fill-white" />
                Старт
              </button>
            )}
          </div>
          {/* Progress bar vs estimate */}
          {estimateSec !== null && estimateSec > 0 && (
            <div className="mt-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${overEstimate ? 'bg-red-400' : 'bg-teal-400'}`}
                style={{ width: `${Math.min(100, (trackedSeconds / estimateSec) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Fields */}
        <div className="px-5 pb-4 flex flex-col gap-0.5">
          {/* Assignee */}
          <div className="flex items-center gap-3 py-2 px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Виконавець</span>
            {isMine ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-semibold"
                  style={{ backgroundColor: member?.color ?? '#14b8a6' }}
                >
                  {member?.name.charAt(0)}
                </div>
                <span className="text-sm font-medium text-teal-600">{member?.name} (ви)</span>
              </div>
            ) : task.team_member_id ? (
              <span className="text-sm text-gray-500">Інший учасник</span>
            ) : (
              <span className="text-sm text-gray-400">Не призначено</span>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Статус</span>
            <select
              value={task.column_id ?? ''}
              onChange={e => onMove(e.target.value)}
              className="flex-1 text-sm font-medium focus:outline-none bg-transparent cursor-pointer"
              style={{ color: currentCol?.color ?? '#374151' }}
            >
              {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Priority */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Пріоритет</span>
            <select
              value={task.priority ?? 'medium'}
              onChange={e => onUpdate({ priority: e.target.value as PMTask['priority'] })}
              className="text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
            >
              <option value="low">Низький</option>
              <option value="medium">Середній</option>
              <option value="high">Високий</option>
            </select>
          </div>

          {/* Start date */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Початок</span>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Calendar size={13} />
              <input
                type="date"
                value={task.start_date ? task.start_date.split('T')[0] : ''}
                onChange={e => onUpdate({ start_date: e.target.value || null })}
                className="text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
              />
            </div>
          </div>

          {/* Due date */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Дедлайн</span>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Calendar size={13} />
              <input
                type="date"
                value={task.due_date ? task.due_date.split('T')[0] : ''}
                onChange={e => onUpdate({ due_date: e.target.value || null })}
                className="text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
              />
            </div>
          </div>

          {/* Estimate */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-28 flex-shrink-0">Естімейт</span>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock size={13} className="text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.5"
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                onBlur={saveEstimate}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                placeholder="—"
                className="w-16 text-sm focus:outline-none bg-transparent border-b border-transparent focus:border-gray-300"
              />
              <span className="text-xs text-gray-400">год</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="px-5 pb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Опис</p>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={saveDesc}
            rows={5}
            placeholder="Додайте опис..."
            className="w-full text-sm text-gray-700 bg-gray-50 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-200 placeholder-gray-300"
          />
        </div>
      </div>
    </div>
  )
}
