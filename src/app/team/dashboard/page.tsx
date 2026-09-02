'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { LogOut, FolderKanban, Flag, Calendar, BarChart2, Plus, CheckSquare, MessageSquare } from 'lucide-react'
import { GeneralChatInfo } from '@/components/GeneralChat'
import ChatsHub from '@/components/chat/ChatsHub'
import { useChatUnread } from '@/lib/chatUnread'
import { DEFAULT_COLUMNS } from '@/lib/defaultColumns'
import TeamNotificationBell from '@/components/TeamNotificationBell'
import ThemeToggle from '@/components/ThemeToggle'
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
  const [generalChats, setGeneralChats] = useState<GeneralChatInfo[]>([])
  // chat_id -> member ids; a chat absent from the map is open to the whole team
  const [chatMembership, setChatMembership] = useState<Record<string, string[]>>({})
  const [tab, setTab] = useState<'projects' | 'tasks' | 'chats'>('projects')
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [loading, setLoading] = useState(true)

  // Unread dots for the Чати tab (keyed by project_id, team channel)
  const unread = useChatUnread({ self: 'team', memberId: member?.id ?? null })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/team/login'); return }

    const { data: mem } = await supabase
      .from('team_members').select('*').eq('supabase_user_id', user.id).single()
    if (!mem) { router.replace('/team/login'); return }
    setMember(mem)

    // Membership + assigned tasks in parallel — a task assignment alone must
    // be enough to see the project, even if membership wasn't added
    const [{ data: pm }, { data: myAssignments }, { data: chats }, chatMembersRes] = await Promise.all([
      supabase.from('project_members').select('project_id').eq('team_member_id', mem.id),
      supabase.from('task_assignees').select('task_id').eq('team_member_id', mem.id),
      supabase.from('general_chats').select('id, name').order('created_at'),
      supabase.from('general_chat_members').select('chat_id, team_member_id'),
    ])
    if (chats) setGeneralChats(chats as GeneralChatInfo[])
    // If the migration isn't run yet the query errors — then every chat is open to all
    if (!chatMembersRes.error && chatMembersRes.data) {
      const map: Record<string, string[]> = {}
      for (const r of chatMembersRes.data as { chat_id: string; team_member_id: string }[]) {
        if (!map[r.chat_id]) map[r.chat_id] = []
        map[r.chat_id].push(r.team_member_id)
      }
      setChatMembership(map)
    }

    const myTaskIds = [...new Set((myAssignments ?? []).map((r: { task_id: string }) => r.task_id))]

    const { data: myTaskRowsData } = myTaskIds.length > 0
      ? await supabase
          .from('pm_tasks')
          .select('id, title, status, priority, due_date, column_id, finance_project_id')
          .in('id', myTaskIds)
          .order('created_at', { ascending: false })
      : { data: [] }
    const myTaskRows = myTaskRowsData ?? []

    // Projects I'm a member of + projects my tasks live in
    const projectIds = [...new Set([
      ...(pm ?? []).map((r: { project_id: string }) => r.project_id),
      ...myTaskRows.map(t => t.finance_project_id).filter((x): x is string => !!x),
    ])]

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

    if (myTaskRows.length === 0) {
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

  // Members with the admin-granted flag can create a project themselves.
  // They become its first member; the admin gets a bell notification.
  async function createProject() {
    const name = newProjectName.trim()
    if (!name || !member || creatingProject) return
    setCreatingProject(true)
    const palette = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#10b981']
    const color = palette[projects.length % palette.length]
    const { data: proj, error } = await supabase
      .from('projects')
      .insert({ name, status: 'active', color })
      .select('id, name')
      .single()
    if (error || !proj) { setCreatingProject(false); return }
    // Seed the standard column set so tasks can be created right away
    const { error: colErr } = await supabase
      .from('pm_columns')
      .insert(DEFAULT_COLUMNS.map(c => ({ ...c, project_id: proj.id })))
    if (colErr) alert('Проєкт створено, але колонки не додалися: ' + colErr.message)
    await supabase.from('project_members').insert({ project_id: proj.id, team_member_id: member.id })
    await supabase.from('notifications').insert({
      type: 'project_created',
      message: `${member.name} створив(ла) проєкт «${proj.name}»`,
      project_id: proj.id,
      team_member_id: member.id,
      recipient_team_member_id: null,
    })
    setNewProjectName('')
    setAddingProject(false)
    setCreatingProject(false)
    router.push(`/team/board/${proj.id}`)
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

  // General chats visible to this member: no membership rows = open to the whole team
  const visibleGeneralChats = generalChats.filter(c => {
    const ids = chatMembership[c.id]
    return !ids || ids.length === 0 || (member ? ids.includes(member.id) : false)
  })

  // Group myTasks by project
  const tasksByProject: Record<string, { projectName: string; tasks: MyTask[] }> = {}
  for (const t of myTasks) {
    const key = t.project_id ?? '__none__'
    if (!tasksByProject[key]) {
      tasksByProject[key] = { projectName: t.project_name ?? 'Без проєкту', tasks: [] }
    }
    tasksByProject[key].tasks.push(t)
  }

  const chatsUnread = projects.some(p => unread[p.id]?.team)

  // ClickUp-style navigation: icon rail on the left (desktop),
  // bottom tab bar on mobile.
  const navItems: { key: 'projects' | 'tasks' | 'chats' | 'reports'; label: string; icon: typeof FolderKanban; dot?: boolean }[] = [
    { key: 'projects', label: 'Проєкти', icon: FolderKanban },
    { key: 'tasks',    label: 'Задачі',  icon: CheckSquare },
    { key: 'chats',    label: 'Чати',    icon: MessageSquare, dot: chatsUnread },
    { key: 'reports',  label: 'Звіт',    icon: BarChart2 },
  ]

  function onNav(key: 'projects' | 'tasks' | 'chats' | 'reports') {
    if (key === 'reports') { router.push('/team/reports'); return }
    setTab(key)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left icon rail (desktop) */}
      <aside className="hidden md:flex w-[76px] bg-[#0f1117] flex-col items-center py-4 gap-1.5 flex-shrink-0 sticky top-0 h-screen">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-semibold text-sm mb-3"
          style={{ backgroundColor: member?.color ?? '#14b8a6' }}
          title={member?.name}
        >
          {member?.name.charAt(0)}
        </div>
        {navItems.map(item => {
          const Icon = item.icon
          const active = item.key === tab
          return (
            <button
              key={item.key}
              onClick={() => onNav(item.key)}
              className={`relative w-14 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-colors ${
                active ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={18} />
              <span className="text-[9px] font-medium">{item.label}</span>
              {item.dot && <span className="absolute top-1.5 right-3 w-2 h-2 rounded-full bg-teal-400 animate-pulse" />}
            </button>
          )
        })}
        <div className="mt-auto flex flex-col items-center gap-2">
          <ThemeToggle variant="sidebar" />
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/5"
            title="Вийти"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
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
          {/* On desktop the theme toggle and logout live in the left rail */}
          <span className="md:hidden"><ThemeToggle variant="sidebar" /></span>
          <button
            onClick={handleLogout}
            className="md:hidden text-gray-400 hover:text-white transition-colors p-1.5 rounded"
            title="Вийти"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto p-6 pb-24 md:pb-6">
        {tab === 'projects' && (<>
        {/* Projects section */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Мої проєкти</h2>
          {member?.can_create_projects && !addingProject && (
            <button
              onClick={() => setAddingProject(true)}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-3.5 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Plus size={14} /> Новий проєкт
            </button>
          )}
        </div>

        {member?.can_create_projects && addingProject && (
          <div className="flex items-center gap-2 mb-4">
            <input
              autoFocus
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createProject()
                if (e.key === 'Escape') { setAddingProject(false); setNewProjectName('') }
              }}
              placeholder="Назва проєкту..."
              className="flex-1 max-w-sm border border-gray-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <button
              onClick={createProject}
              disabled={creatingProject || !newProjectName.trim()}
              className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {creatingProject ? 'Створюємо...' : 'Створити'}
            </button>
            <button
              onClick={() => { setAddingProject(false); setNewProjectName('') }}
              className="text-gray-400 hover:text-gray-600 text-sm px-2"
            >
              Скасувати
            </button>
          </div>
        )}

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
        </>)}

        {tab === 'tasks' && (<>
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
        </>)}

        {tab === 'chats' && member && (
          <ChatsHub
            projects={projects}
            generalChats={visibleGeneralChats}
            sender={{ type: 'team', name: member.name, teamMemberId: member.id }}
            unread={unread}
          />
        )}
      </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-[#0f1117] border-t border-white/10 flex z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navItems.map(item => {
          const Icon = item.icon
          const active = item.key === tab
          return (
            <button
              key={item.key}
              onClick={() => onNav(item.key)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
                active ? 'text-white' : 'text-gray-500'
              }`}
            >
              <Icon size={18} />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.dot && <span className="absolute top-1.5 right-[28%] w-2 h-2 rounded-full bg-teal-400 animate-pulse" />}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
