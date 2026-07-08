'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TeamMember, SalaryPayment } from '@/types'
import { LogOut, Clock, Calendar, ArrowLeft, Wallet } from 'lucide-react'
import TeamNotificationBell from '@/components/TeamNotificationBell'

type Period = 'today' | 'week' | 'month'
type Tab = 'time' | 'salary'

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

function monthLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split('-')
  const s = new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function TeamReportsPage() {
  const router = useRouter()
  const [member, setMember] = useState<TeamMember | null>(null)
  const [tab, setTab] = useState<Tab>('time')
  const [period, setPeriod] = useState<Period>('today')
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [loading, setLoading] = useState(true)

  // Salary tab state
  const [payments, setPayments] = useState<SalaryPayment[]>([])
  const [currentSeconds, setCurrentSeconds] = useState(0)
  const [salaryLoading, setSalaryLoading] = useState(true)

  useEffect(() => { init() }, [])
  useEffect(() => { if (member) fetchEntries(member.id, period) }, [period])
  useEffect(() => { if (member && tab === 'salary') fetchSalary(member.id) }, [tab, member])

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

  async function fetchSalary(memberId: string) {
    setSalaryLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [{ data: pays }, { data: ents }] = await Promise.all([
      supabase.from('salary_payments')
        .select('*')
        .eq('team_member_id', memberId)
        .order('period_month', { ascending: false }),
      supabase.from('time_entries')
        .select('duration_seconds')
        .eq('team_member_id', memberId)
        .not('ended_at', 'is', null)
        .gte('started_at', monthStart.toISOString()),
    ])

    setPayments((pays ?? []) as SalaryPayment[])
    setCurrentSeconds((ents ?? []).reduce(
      (s: number, e: { duration_seconds: number | null }) => s + (e.duration_seconds ?? 0), 0
    ))
    setSalaryLoading(false)
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
        <button
          onClick={() => router.push('/team/dashboard')}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm mr-1"
        >
          <ArrowLeft size={15} /> Назад
        </button>
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

      {/* Top-level tabs: time / salary */}
      <div className="bg-white border-b border-gray-100 px-6">
        <div className="flex gap-1 max-w-3xl mx-auto">
          {([
            { key: 'time' as Tab, label: 'Час', icon: Clock },
            { key: 'salary' as Tab, label: 'Зарплата', icon: Wallet },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Period tabs (time tab only) */}
      {tab === 'time' && (
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
      )}

      {tab === 'salary' && (
        <main className="max-w-3xl mx-auto p-6">
          {/* Current month accrual */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 flex items-center gap-4">
            <div className="w-12 h-12 bg-teal-50 rounded-xl flex items-center justify-center">
              <Wallet size={22} className="text-teal-500" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-0.5">Поточний місяць (нараховано)</p>
              <p className="text-3xl font-bold text-gray-900">
                ${(Math.round((currentSeconds / 3600) * (member?.hourly_rate_usd ?? 0) * 100) / 100).toFixed(2)}
                <span className="text-sm font-medium text-gray-400 ml-2">· {formatDuration(currentSeconds)}</span>
              </p>
            </div>
            <p className="text-xs text-gray-400 self-start">
              Ваш рейт: ${member?.hourly_rate_usd ?? 0}/год
            </p>
          </div>

          {salaryLoading ? (
            <div className="text-center py-10 text-gray-400 text-sm">Завантаження...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">
              <Wallet size={28} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Виплат поки немає</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between px-5 py-4 gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{monthLabel(p.period_month)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDuration(p.total_seconds)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-900">${p.amount_usd.toFixed(2)}</span>
                    {p.status === 'paid' ? (
                      <span className="text-xs bg-teal-50 text-teal-600 px-2.5 py-1 rounded-full font-medium">
                        Виплачено {p.paid_at ? new Date(p.paid_at).toLocaleDateString('uk-UA') : ''}
                      </span>
                    ) : (
                      <span className="text-xs bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full font-medium">
                        Підтверджено, очікує виплати
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {tab === 'time' && (
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
      )}
    </div>
  )
}
