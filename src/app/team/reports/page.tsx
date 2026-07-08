'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { LogOut, Clock, Calendar } from 'lucide-react'
import TeamNotificationBell from '@/components/TeamNotificationBell'

type Period = 'today' | 'week' | 'month'

interface TimeEntry {
  id: string
  started_at: string
  ended_at: string
  duration_seconds: number
  task_id: string
  task_title: string
  project_id: string | null
  project_name: string | null
}

interface ProjectGroup {
  projectId: string | null
  projectName: string
  entries: TimeEntry[]
  totalSeconds: number
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}с`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}хв`
  if (m === 0) return `${h}г`
  return `${h}г ${m}хв`
}

export default function TeamReportsPage() {
  const router = useRouter()
  const [member, setMember] = useState<TeamMember | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])
  useEffect(() => { if (member) fetchEntries(member.id, period) }, [period])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/team/login'); return }

    const { data: mem } = await supabase
      .from('team_members').select('*').eq('supabase_user_id', user.id).single()
    if (!mem) { router.replace('/team/login'); return }
    setMember(mem)
    await fetchEntries(mem.id, period)
  }

  async function fetchEntries(memberId: string, selectedPeriod: Period) {
    setLoading(true)

    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const filterDate =
      selectedPeriod === 'today' ? startOfDay :
      selectedPeriod === 'week' ? startOfWeek :
      startOfMonth

    const { data: entries } = await supabase
      .from('time_entries')
      .select('id, started_at, ended_at, duration_seconds, task_id')
      .eq('team_member_id', memberId)
      .not('ended_at', 'is', null)
      .gte('started_at', filterDate.toISOString())
      .order('started_at', { ascending: false })

    if (!entries || entries.length === 0) {
      setGroups([])
      setTotalSeconds(0)
      setLoading(false)
      return
    }

    // Get task info
    const taskIds = [...new Set(entries.map((e: { task_id: string }) => e.task_id))]
    const { data: taskRows } = await supabase
      .from('pm_tasks')
      .select('id, title, finance_project_id')
      .in('id', taskIds)

    const taskMap: Record<string, { title: string; projectId: string | null }> = {}
    const projectIds: string[] = []
    for (const t of taskRows ?? []) {
      taskMap[t.id] = { title: t.title, projectId: t.finance_project_id }
      if (t.finance_project_id) projectIds.push(t.finance_project_id)
    }

    // Get project names
    const uniqueProjectIds = [...new Set(projectIds)]
    const { data: projRows } = uniqueProjectIds.length > 0
      ? await supabase.from('projects').select('id, name').in('id', uniqueProjectIds)
      : { data: [] }

    const projMap: Record<string, string> = {}
    for (const p of projRows ?? []) projMap[p.id] = p.name

    // Build entries with task/project info
    const enriched: TimeEntry[] = entries.map((e: {
      id: string; started_at: string; ended_at: string; duration_seconds: number; task_id: string
    }) => {
      const task = taskMap[e.task_id]
      return {
        id: e.id,
        started_at: e.started_at,
        ended_at: e.ended_at,
        duration_seconds: e.duration_seconds ?? 0,
        task_id: e.task_id,
        task_title: task?.title ?? 'Невідома задача',
        project_id: task?.projectId ?? null,
        project_name: task?.projectId ? (projMap[task.projectId] ?? 'Невідомий проєкт') : null,
      }
    })

    // Group by project
    const groupMap: Record<string, ProjectGroup> = {}
    for (const entry of enriched) {
      const key = entry.project_id ?? '__none__'
      if (!groupMap[key]) {
        groupMap[key] = {
          projectId: entry.project_id,
          projectName: entry.project_name ?? 'Без проєкту',
          entries: [],
          totalSeconds: 0,
        }
      }
      groupMap[key].entries.push(entry)
      groupMap[key].totalSeconds += entry.duration_seconds
    }

    const groupList = Object.values(groupMap)
    const total = groupList.reduce((s, g) => s + g.totalSeconds, 0)

    setGroups(groupList)
    setTotalSeconds(total)
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/team/login')
  }

  const periodLabel: Record<Period, string> = {
    today: 'Сьогодні',
    week: 'Тиждень',
    month: 'Місяць',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0f1117] text-white px-6 py-4 flex items-center gap-3">
        {member && (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
            style={{ backgroundColor: member.color ?? '#14b8a6' }}
          >
            {member.name.charAt(0)}
          </div>
        )}
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

      {/* Period tabs */}
      <div className="bg-white border-b border-gray-100 px-6">
        <div className="flex gap-1 max-w-3xl mx-auto">
          {(['today', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                period === p
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-3xl mx-auto p-6">
        {/* Total time */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-teal-50 rounded-xl flex items-center justify-center">
            <Clock size={22} className="text-teal-500" />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Загальний час ({periodLabel[period].toLowerCase()})</p>
            <p className="text-3xl font-bold text-gray-900">
              {totalSeconds > 0 ? formatDuration(totalSeconds) : '—'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Завантаження...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <Clock size={28} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Немає записів за цей період</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(group => (
              <div key={group.projectId ?? '__none__'} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                {/* Project header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 bg-gray-50/50">
                  <p className="text-sm font-semibold text-gray-800">{group.projectName}</p>
                  <span className="text-xs font-bold text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full">
                    {formatDuration(group.totalSeconds)}
                  </span>
                </div>

                {/* Entries */}
                <div className="divide-y divide-gray-50">
                  {group.entries.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between px-5 py-3 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{entry.task_title}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Calendar size={10} />
                          {new Date(entry.started_at).toLocaleDateString('uk-UA', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-gray-500 flex-shrink-0">
                        {formatDuration(entry.duration_seconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
