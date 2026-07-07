'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { Calendar, Flag, AlertCircle } from 'lucide-react'

interface TaskWithProject {
  id: string
  title: string
  description: string | null
  priority: string | null
  due_date: string | null
  column_id: string | null
  finance_project_id: string | null
  column_name?: string
  column_color?: string
  project_name?: string
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#9CA3AF',
  medium: '#F59E0B',
  high: '#EF4444',
}

export default function TeamMemberPage() {
  const { token } = useParams<{ token: string }>()
  const [member, setMember]   = useState<TeamMember | null>(null)
  const [tasks, setTasks]     = useState<TaskWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (token) loadData()
  }, [token])

  async function loadData() {
    setLoading(true)

    const { data: mem } = await supabase
      .from('team_members')
      .select('*')
      .eq('access_token', token)
      .single()

    if (!mem) { setNotFound(true); setLoading(false); return }
    setMember(mem)

    const { data: rawTasks } = await supabase
      .from('pm_tasks')
      .select('id, title, description, priority, due_date, column_id, finance_project_id')
      .eq('team_member_id', mem.id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (!rawTasks || rawTasks.length === 0) {
      setTasks([]); setLoading(false); return
    }

    const colIds = [...new Set(rawTasks.map(t => t.column_id).filter(Boolean))]
    const projIds = [...new Set(rawTasks.map(t => t.finance_project_id).filter(Boolean))]

    const [{ data: cols }, { data: projs }] = await Promise.all([
      colIds.length > 0
        ? supabase.from('pm_columns').select('id, name, color').in('id', colIds)
        : Promise.resolve({ data: [] }),
      projIds.length > 0
        ? supabase.from('projects').select('id, name').in('id', projIds)
        : Promise.resolve({ data: [] }),
    ])

    const colMap = new Map((cols ?? []).map(c => [c.id, c]))
    const projMap = new Map((projs ?? []).map(p => [p.id, p]))

    setTasks(rawTasks.map(t => ({
      ...t,
      column_name: t.column_id ? colMap.get(t.column_id)?.name : undefined,
      column_color: t.column_id ? colMap.get(t.column_id)?.color : undefined,
      project_name: t.finance_project_id ? projMap.get(t.finance_project_id)?.name : undefined,
    })))

    setLoading(false)
  }

  async function moveTask(taskId: string, newStatus: string) {
    const col = tasks.find(t => t.id === taskId)
    if (!col) return
    const { data: cols } = await supabase
      .from('pm_columns')
      .select('id, name, color')
      .eq('project_id', col.finance_project_id)
      .ilike('name', newStatus)
      .single()
    if (!cols) return
    await supabase.from('pm_tasks').update({ column_id: cols.id }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, column_id: cols.id, column_name: cols.name, column_color: cols.color
    } : t))
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Завантаження...</p>
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <AlertCircle size={40} className="mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 font-medium">Посилання недійсне</p>
        <p className="text-sm text-gray-400 mt-1">Зверніться до адміністратора</p>
      </div>
    </div>
  )

  const grouped = tasks.reduce<Record<string, TaskWithProject[]>>((acc, t) => {
    const key = t.project_name ?? 'Без проекту'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0f1117] text-white px-6 py-4 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
          style={{ backgroundColor: member?.color ?? '#14b8a6' }}
        >
          {member?.name.charAt(0)}
        </div>
        <div>
          <p className="font-semibold text-sm">{member?.name}</p>
          <p className="text-xs text-gray-400">{member?.role}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-400">Мої задачі</p>
          <p className="text-sm font-medium text-teal-400">{tasks.length} задач</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        {tasks.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-1">🎉</p>
            <p className="font-medium">Немає призначених задач</p>
            <p className="text-sm mt-1">Насолоджуйтесь вільним часом!</p>
          </div>
        ) : (
          Object.entries(grouped).map(([projectName, projectTasks]) => (
            <div key={projectName} className="mb-8">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {projectName}
              </h2>
              <div className="flex flex-col gap-2">
                {projectTasks.map(task => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  )
}

function TaskRow({ task }: { task: TaskWithProject }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
          {task.description && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        {task.column_name && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0"
            style={{
              backgroundColor: (task.column_color ?? '#6B7280') + '22',
              color: task.column_color ?? '#6B7280',
            }}
          >
            {task.column_name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 mt-3">
        {task.due_date && (
          <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
            <Calendar size={11} />
            {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
            {isOverdue && <span className="text-red-400 ml-1">прострочено</span>}
          </span>
        )}
        {task.priority && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Flag size={11} style={{ color: PRIORITY_COLOR[task.priority] ?? '#9CA3AF' }} />
            {task.priority === 'high' ? 'Високий' : task.priority === 'medium' ? 'Середній' : 'Низький'}
          </span>
        )}
      </div>
    </div>
  )
}
