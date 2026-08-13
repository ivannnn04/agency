'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchAssigneesByTask } from '@/lib/assignees'
import { TeamMember } from '@/types'
import { PMColumn, PMTask } from '@/types/pm'
import { Calendar, Flag, AlignLeft, FolderKanban } from 'lucide-react'

interface ClientProject {
  id: string
  name: string
  color?: string | null
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#9CA3AF',
  medium: '#F59E0B',
  high: '#EF4444',
}

function memberInitial(m: TeamMember) {
  return m.name.charAt(0).toUpperCase()
}

export default function ClientStatusPage() {
  const { token } = useParams<{ token: string }>()

  const [project, setProject] = useState<ClientProject | null>(null)
  const [columns, setColumns] = useState<PMColumn[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [assigneesByTask, setAssigneesByTask] = useState<Record<string, string[]>>({})
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const { data: proj } = await supabase
        .from('projects')
        .select('id, name, color')
        .eq('client_access_token', token)
        .single()

      if (!proj) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setProject(proj)

      const [{ data: cols }, { data: tx }, { data: mems }] = await Promise.all([
        supabase.from('pm_columns').select('*').eq('project_id', proj.id).order('position'),
        supabase.from('pm_tasks').select('*').eq('finance_project_id', proj.id).order('created_at'),
        supabase.from('team_members').select('id, name, color'),
      ])
      setColumns(cols ?? [])
      setTasks(tx ?? [])
      setMembers((mems ?? []) as TeamMember[])
      if (tx) setAssigneesByTask(await fetchAssigneesByTask(tx.map(t => t.id)))
      setLoading(false)
    })()
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        Завантаження...
      </div>
    )
  }

  if (notFound || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <FolderKanban size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 text-sm">Посилання недійсне або було скинуте.</p>
        </div>
      </div>
    )
  }

  const totalTasks = tasks.length
  const segments = columns.map(col => ({
    col,
    count: tasks.filter(t => t.column_id === col.id).length,
  }))

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#0f1117] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">G</span>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">{project.name}</p>
          <p className="text-gray-400 text-xs">Статус проєкту · Gudrix</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Progress overview */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Загальний прогрес</h2>
            <span className="text-xs text-gray-400">{totalTasks} задач</span>
          </div>
          {totalTasks > 0 ? (
            <>
              <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
                {segments.filter(s => s.count > 0).map(s => (
                  <div
                    key={s.col.id}
                    style={{ width: `${(s.count / totalTasks) * 100}%`, backgroundColor: s.col.color }}
                    title={`${s.col.name}: ${s.count}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {segments.map(s => (
                  <div key={s.col.id} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.col.color }} />
                    <span className="text-xs text-gray-500">{s.col.name}</span>
                    <span className="text-xs text-gray-400 font-medium">{s.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Задач ще немає.</p>
          )}
        </div>

        {/* Read-only board */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.column_id === col.id)
            return (
              <div key={col.id} className="flex-shrink-0 w-[280px] flex flex-col">
                <div className="flex items-center gap-2 px-1 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-xs font-bold tracking-wide uppercase" style={{ color: col.color }}>
                    {col.name}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">{colTasks.length}</span>
                </div>

                <div className="flex flex-col gap-2">
                  {colTasks.map(task => {
                    const assignedMembers = (assigneesByTask[task.id] ?? [])
                      .map(mid => members.find(m => m.id === mid))
                      .filter((m): m is TeamMember => !!m)
                    return (
                      <div
                        key={task.id}
                        className="bg-white rounded-xl border border-gray-100 p-3.5"
                      >
                        <p className="text-sm text-gray-800 leading-snug mb-2">{task.title}</p>
                        {task.description && (
                          <div className="flex items-center gap-1 mb-2 text-gray-400">
                            <AlignLeft size={11} />
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            {assignedMembers.length > 0 && (
                              <div className="flex items-center">
                                {assignedMembers.map(m => (
                                  <div
                                    key={m.id}
                                    title={m.name}
                                    className="w-5 h-5 rounded-full ring-2 ring-white -ml-1.5 first:ml-0 flex items-center justify-center text-white text-[9px] font-semibold flex-shrink-0"
                                    style={{ backgroundColor: m.color }}
                                  >
                                    {memberInitial(m)}
                                  </div>
                                ))}
                              </div>
                            )}
                            {task.due_date && (
                              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                                <Calendar size={11} />
                                {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            <Flag size={11} style={{ color: PRIORITY_COLOR[task.priority ?? 'medium'] }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {colTasks.length === 0 && (
                    <p className="text-xs text-gray-300 px-1">Немає задач</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
