'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { LogOut, FolderKanban, Flag, Calendar } from 'lucide-react'
import TeamNotificationBell from '@/components/TeamNotificationBell'
import Link from 'next/link'

interface ProjectCard {
  id: string
  name: string
  color: string
  taskCount: number
}

interface MyTask {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  column_id: string | null
  column_name: string | null
  column_color: string | null
  project_id: string | null
  project_name: string | null
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#9CA3AF',
  medium: '#F59E0B',
  high: '#EF4444',
}

export default function TeamDashboardPage() {
  const router = useRouter()
  const [member, setMember] = useState<TeamMember | null>(null)
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [myTasks, setMyTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/team/login'); return }

    const { data: mem } = await supabase
      .from('team_members').select('*').eq('supabase_user_id', user.id).single()
    if (!mem) { router.replace('/team/login'); return }
    setMember(mem)

    // Get project_members
    const { data: pm } = await supabase
      .from('project_members').select('project_id').eq('team_member_id', mem.id)

    const projectIds = (pm ?? []).map((r: { project_id: string }) => r.project_id)

    if (projectIds.length === 0) {
      setProjects([])
      setMyTasks([])
      setLoading(false)
      return
    }

    // Fetch projects
    const { data: projs } = await supabase
      .from('projects')
      .select('id, name, color')
      .in('id', projectIds)
      .order('name')

    // Fetch task counts per project
    const { data: allTasks } = await supabase
      .from('pm_tasks')
      .select('id, finance_project_id')
      .in('finance_project_id', projectIds)

    const taskCountMap: Record<string, number> = {}
    for (const t of allTasks ?? []) {
      if (t.finance_project_id) {
        taskCountMap[t.finance_project_id] = (taskCountMap[t.finance_project_id] ?? 0) + 1
      }
    }

    setProjects(
      (projs ?? []).map((p: { id: string; name: string; color: string }) => ({
        id: p.id,
        name: p.name,
        color: p.color ?? '#14b8a6',
        taskCount: taskCountMap[p.id] ?? 0,
      }))
    )

    // Fetch my assigned tasks with column info
    const { data: myTaskRows } = await supabase
      .from('pm_tasks')
      .select('id, title, status, priority, due_date, column_id, finance_project_id')
      .eq('team_member_id', mem.id)
      .order('created_at', { ascending: false })

    if (!myTaskRows || myTaskRows.length === 0) {
      setMyTasks([])
      setLoading(false)
      return
    }

    // Get column info
    const columnIds = [...new Set(myTaskRows.map((t: { column_id: string | null }) => t.column_id).filter(Boolean))] as string[]
    const { data: cols } = columnIds.length > 0
      ? await supabase.from('pm_columns').select('id, name, color').in('id', columnIds)
      : { data: [] }

    const colMap: Record<string, { name: string; color: string }> = {}
    for (const c of cols ?? []) colMap[c.id] = { name: c.name, color: c.color }

    const projMap: Record<string, string> = {}
    for (const p of projs ?? []) projMap[p.id] = p.name

    setMyTasks(myTaskRows.map((t: {
      id: string; title: string; status: string | null; priority: string | null;
      due_date: string | null; column_id: string | null; finance_project_id: string | null
    }) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      column_id: t.column_id,
      column_name: t.column_id ? (colMap[t.column_id]?.name ?? null) : null,
      column_color: t.column_id ? (colMap[t.column_id]?.color ?? null) : null,
      project_id: t.finance_project_id,
      project_name: t.finance_project_id ? (projMap[t.finance_project_id] ?? null) : null,
    })))

    setLoading(false)
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

  // Group myTasks by project
  const tasksByProject: Record<string, { projectName: string; tasks: MyTask[] }> = {}
  for (const t of myTasks) {
    const key = t.project_id ?? '__none__'
    if (!tasksByProject[key]) {
      tasksByProject[key] = { projectName: t.project_name ?? 'Без проєкту', tasks: [] }
    }
    tasksByProject[key].tasks.push(t)
  }

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
        <div className="ml-auto flex items-center gap-3">
          {member && <TeamNotificationBell memberId={member.id} />}
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded"
            title="Вийти"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        {/* Projects section */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Мої проєкти</h2>

        {projects.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100 mb-8">
            <FolderKanban size={32} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Вас ще не додали до жодного проєкту</p>
            <p className="text-sm mt-1">Зверніться до адміністратора</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            {projects.map(project => (
              <div
                key={project.id}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
                style={{ borderLeft: `4px solid ${project.color}` }}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">{project.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{project.taskCount} задач</p>
                    </div>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: project.color + '22' }}
                    >
                      <FolderKanban size={16} style={{ color: project.color }} />
                    </div>
                  </div>
                  <Link
                    href={`/team/board/${project.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-white px-3 py-1.5 rounded-lg transition-colors"
                    style={{ backgroundColor: project.color }}
                  >
                    Відкрити борду
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* My tasks section */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Мої задачі</h2>

        {myTasks.length === 0 ? (
          <div className="text-center py-10 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <p className="text-sm">Немає призначених задач</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {Object.entries(tasksByProject).map(([key, group]) => (
              <div key={key}>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 px-1">
                  {group.projectName}
                </p>
                <div className="flex flex-col gap-2">
                  {group.tasks.map(task => {
                    const isOverdue = task.due_date && new Date(task.due_date) < new Date()
                    return (
                      <div
                        key={task.id}
                        className="bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {task.column_name && (
                              <span
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: (task.column_color ?? '#9CA3AF') + '22',
                                  color: task.column_color ?? '#9CA3AF',
                                }}
                              >
                                {task.column_name}
                              </span>
                            )}
                            {task.priority && (
                              <Flag
                                size={12}
                                style={{ color: PRIORITY_COLOR[task.priority] ?? '#9CA3AF' }}
                              />
                            )}
                          </div>
                        </div>
                        {task.due_date && (
                          <span
                            className={`flex items-center gap-1 text-xs mt-2 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}
                          >
                            <Calendar size={11} />
                            {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                            {isOverdue && <span className="ml-1">прострочено</span>}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
