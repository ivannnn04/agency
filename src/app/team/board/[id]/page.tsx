'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { PMColumn, PMTask } from '@/types/pm'
import {
  ArrowLeft, LogOut, Plus, Flag, Calendar, User, Play, Square, Timer,
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

export default function TeamBoardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [member, setMember] = useState<TeamMember | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [columns, setColumns] = useState<PMColumn[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'gantt'>('board')

  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [saving, setSaving] = useState(false)

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
    if (tx) setTasks(tx)

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
    if (activeTimer) {
      // Stop current timer first
      const endedAt = new Date()
      const duration = Math.floor((endedAt.getTime() - activeTimer.startedAt.getTime()) / 1000)
      await supabase
        .from('time_entries')
        .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
        .eq('id', activeTimer.entryId)
      setActiveTimer(null)
    }

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

  async function updateTaskDates(taskId: string, patch: { start_date?: string | null; due_date?: string | null }) {
    await supabase.from('pm_tasks').update(patch).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
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
      {view === 'board' ? (
        <div className="flex gap-4 p-5 overflow-x-auto flex-1 items-start">
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.column_id === col.id)
            return (
              <div key={col.id} className="flex-shrink-0 w-[280px] flex flex-col">
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
                <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-200px)]">
                  {colTasks.map(task => {
                    const isThisTaskActive = activeTimer?.taskId === task.id
                    const otherTaskActive = activeTimer && activeTimer.taskId !== task.id
                    const isOverdue = task.due_date && new Date(task.due_date) < new Date()

                    return (
                      <div
                        key={task.id}
                        className="bg-white rounded-xl border border-gray-100 p-3.5 hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        <p className="text-sm text-gray-800 leading-snug mb-3">{task.title}</p>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            {/* Assignee circle */}
                            {task.team_member_id ? (
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0 bg-teal-500"
                                title="Призначено"
                              >
                                <User size={10} />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center">
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
                          </div>

                          {/* Timer button */}
                          {isThisTaskActive ? (
                            <button
                              onClick={stopTimer}
                              className="flex items-center gap-1 text-[11px] font-mono text-red-500 hover:text-red-600 transition-colors"
                              title="Зупинити таймер"
                            >
                              <Square size={11} className="fill-red-500" />
                              {formatElapsed(elapsed)}
                            </button>
                          ) : otherTaskActive ? (
                            <button
                              className="p-1 text-gray-200 cursor-not-allowed"
                              disabled
                              title="Інший таймер активний"
                            >
                              <Play size={12} />
                            </button>
                          ) : (
                            <button
                              onClick={() => startTimer(task.id)}
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

      {/* Active timer indicator */}
      {activeTimer && view === 'board' && (
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
