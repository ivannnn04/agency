'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { Calendar, Flag, LogOut, Plus, X } from 'lucide-react'

interface TaskData {
  id: string
  title: string
  description: string | null
  priority: string | null
  due_date: string | null
  team_member_id: string | null
}

interface ColumnData {
  id: string
  name: string
  color: string
  tasks: TaskData[]
}

interface ProjectData {
  id: string
  name: string
  columns: ColumnData[]
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#9CA3AF', medium: '#F59E0B', high: '#EF4444',
}

export default function TeamDashboardPage() {
  const router = useRouter()
  const [member, setMember]     = useState<TeamMember | null>(null)
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [loading, setLoading]   = useState(true)
  const [addingTask, setAddingTask] = useState<{ projectId: string; columnId: string } | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/team/login'); return }

    const { data: mem } = await supabase
      .from('team_members').select('*').eq('supabase_user_id', user.id).single()
    if (!mem) { router.replace('/team/login'); return }
    setMember(mem)

    const { data: pm } = await supabase
      .from('project_members').select('project_id').eq('team_member_id', mem.id)

    if (!pm || pm.length === 0) { setProjects([]); setLoading(false); return }

    const projectIds = pm.map(r => r.project_id)
    const { data: projs } = await supabase
      .from('projects').select('id, name').in('id', projectIds).order('name')

    if (!projs) { setLoading(false); return }

    const projectData = await Promise.all(
      projs.map(async proj => {
        const [{ data: cols }, { data: txs }] = await Promise.all([
          supabase.from('pm_columns').select('id, name, color, position').eq('project_id', proj.id).order('position'),
          supabase.from('pm_tasks').select('id, title, description, priority, due_date, team_member_id, column_id')
            .eq('finance_project_id', proj.id).order('created_at'),
        ])
        return {
          id: proj.id,
          name: proj.name,
          columns: (cols ?? []).map(col => ({
            ...col,
            tasks: (txs ?? []).filter(t => t.column_id === col.id),
          })),
        }
      })
    )

    setProjects(projectData)
    setLoading(false)
  }

  async function createTask(projectId: string, columnId: string) {
    if (!newTaskTitle.trim() || !member) return
    setSaving(true)

    const project = projects.find(p => p.id === projectId)
    const res = await fetch('/api/team/create-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        finance_project_id: projectId,
        column_id: columnId,
        team_member_id: member.id,
        created_by: member.name,
        project_name: project?.name ?? '',
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) return

    const newTask: TaskData = {
      id: json.task.id,
      title: json.task.title,
      description: null,
      priority: json.task.priority,
      due_date: null,
      team_member_id: member.id,
    }

    setProjects(prev => prev.map(p => p.id !== projectId ? p : {
      ...p,
      columns: p.columns.map(c => c.id !== columnId ? c : {
        ...c, tasks: [...c.tasks, newTask],
      }),
    }))
    setNewTaskTitle('')
    setAddingTask(null)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/team/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Завантаження...</p>
    </div>
  )

  const totalTasks = projects.reduce((s, p) => s + p.columns.reduce((cs, c) => cs + c.tasks.length, 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
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
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-400">Задач у роботі</p>
            <p className="text-sm font-medium text-teal-400">{totalTasks}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded"
            title="Вийти"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6">
        {projects.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="font-medium">Вас ще не додали до жодного проєкту</p>
            <p className="text-sm mt-1">Зверніться до адміністратора</p>
          </div>
        ) : (
          projects.map(project => (
            <div key={project.id} className="mb-10">
              <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
                {project.name}
              </h2>

              <div className="flex flex-col gap-5">
                {project.columns.map(col => (
                  <div key={col.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: col.color }}>
                        {col.name}
                      </span>
                      <span className="text-xs text-gray-400 font-medium">{col.tasks.length}</span>
                    </div>

                    <div className="flex flex-col gap-2 pl-4">
                      {col.tasks.map(task => <TaskRow key={task.id} task={task} />)}

                      {addingTask?.projectId === project.id && addingTask?.columnId === col.id ? (
                        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                          <input
                            autoFocus
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') createTask(project.id, col.id)
                              if (e.key === 'Escape') { setAddingTask(null); setNewTaskTitle('') }
                            }}
                            placeholder="Назва задачі..."
                            className="w-full text-sm focus:outline-none"
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => createTask(project.id, col.id)}
                              disabled={!newTaskTitle.trim() || saving}
                              className="text-xs bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg transition-colors"
                            >
                              {saving ? 'Збереження...' : 'Зберегти'}
                            </button>
                            <button
                              onClick={() => { setAddingTask(null); setNewTaskTitle('') }}
                              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              Скасувати
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAddingTask({ projectId: project.id, columnId: col.id })
                            setNewTaskTitle('')
                          }}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors"
                        >
                          <Plus size={12} /> Додати задачу
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  )
}

function TaskRow({ task }: { task: TaskData }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5 hover:border-gray-200 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
        {task.priority && (
          <Flag
            size={12}
            className="flex-shrink-0 mt-0.5"
            style={{ color: PRIORITY_COLOR[task.priority] ?? '#9CA3AF' }}
          />
        )}
      </div>
      {task.description && (
        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.description}</p>
      )}
      {task.due_date && (
        <span className={`flex items-center gap-1 text-xs mt-2 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
          <Calendar size={11} />
          {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
          {isOverdue && <span className="ml-1">прострочено</span>}
        </span>
      )}
    </div>
  )
}
