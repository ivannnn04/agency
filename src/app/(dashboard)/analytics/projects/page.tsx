'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import {
  ArrowLeft, ChevronDown, ChevronUp, TrendingUp, TrendingDown, DollarSign,
  Plus, Edit2, Archive, Trash2, LayoutDashboard,
} from 'lucide-react'
import Link from 'next/link'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { Project } from '@/types'
import ProjectModal from '@/components/modals/ProjectModal'

interface ProjectStats {
  id: string
  name: string
  income: number
  expense: number
  accrued_salary: number
  planned_income: number
  planned_expense: number
  profit: number
  margin: number
  roi: number
}

interface MonthPoint { month: string; income: number; expense: number }
interface ByPerson  { name: string; income: number; expense: number; profit: number }
interface TxRow {
  id: string; date: string; type: string; amount: number; currency: string
  comment?: string; is_planned: boolean
  counterparty?: { name: string } | null
  category?: { name: string } | null
}

interface Detail {
  monthly: MonthPoint[]
  byPerson: ByPerson[]
  transactions: TxRow[]
}

const MONTHS = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру']
const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function fmt(n: number) {
  return '€' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function ProjectsPage() {
  const [projects, setProjects]   = useState<ProjectStats[]>([])
  const [rawById, setRawById]     = useState<Record<string, Project>>({})
  const [archived, setArchived]   = useState<Project[]>([])
  const [year, setYear]           = useState(new Date().getFullYear())
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [details, setDetails]     = useState<Record<string, Detail>>({})
  const [loading, setLoading]     = useState<string | null>(null)
  const [showPlanned, setShowPlanned] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [addOpen, setAddOpen]     = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const { toEUR, loading: ratesLoading } = useRates()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ratesLoading) fetchSummary() }, [year, ratesLoading])

  // Accrued (not yet paid) tracker salary per project:
  // time_entries → pm_tasks.finance_project_id, months without a paid salary_payments row
  async function fetchAccruedSalary(): Promise<Record<string, number>> {
    const yearStart = new Date(year, 0, 1)
    const yearEnd   = new Date(year + 1, 0, 1)

    const [{ data: entries }, { data: tasks }, { data: members }, { data: paidRows }] = await Promise.all([
      supabase.from('time_entries')
        .select('team_member_id, task_id, duration_seconds, started_at')
        .not('ended_at', 'is', null)
        .gte('started_at', yearStart.toISOString())
        .lt('started_at', yearEnd.toISOString()),
      supabase.from('pm_tasks').select('id, finance_project_id'),
      supabase.from('team_members').select('id, hourly_rate_usd'),
      supabase.from('salary_payments').select('team_member_id, period_month').eq('status', 'paid'),
    ])

    const projByTask: Record<string, string | null> = {}
    for (const t of tasks ?? []) projByTask[t.id] = t.finance_project_id

    const rateByMember: Record<string, number> = {}
    for (const m of members ?? []) rateByMember[m.id] = m.hourly_rate_usd ?? 0

    // "memberId|YYYY-MM" pairs already paid out
    const paidSet = new Set(
      (paidRows ?? []).map(r => `${r.team_member_id}|${String(r.period_month).slice(0, 7)}`)
    )

    const accrued: Record<string, number> = {}
    for (const e of entries ?? []) {
      const projectId = projByTask[e.task_id]
      if (!projectId) continue
      const rate = rateByMember[e.team_member_id] ?? 0
      if (rate <= 0) continue
      const d = new Date(e.started_at)
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (paidSet.has(`${e.team_member_id}|${monthKey}`)) continue
      accrued[projectId] = (accrued[projectId] ?? 0) + ((e.duration_seconds ?? 0) / 3600) * rate
    }
    // Rates are $/hour — convert the accrued totals into the EUR base
    for (const k of Object.keys(accrued)) accrued[k] = Math.round(toEUR(accrued[k], 'USD') * 100) / 100
    return accrued
  }

  async function fetchSummary() {
    const { data: projs } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    const { data: txs }   = await supabase
      .from('transactions')
      .select('type, amount, currency, project_id, is_planned')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)

    if (!projs || !txs) return

    const byId: Record<string, Project> = {}
    for (const p of projs) byId[p.id] = p
    setRawById(byId)
    setArchived(projs.filter(p => p.status === 'archived'))

    const accruedByProject = await fetchAccruedSalary()

    const active = projs.filter(p => p.status !== 'archived')
    const stats = active.map(p => {
      const ptxs = txs.filter(t => t.project_id === p.id)
      const actual  = ptxs.filter(t => !t.is_planned)
      const planned = ptxs.filter(t => t.is_planned)

      const income          = actual.filter(t => t.type === 'income').reduce((s, t)  => s + toEUR(t.amount, t.currency), 0)
      const expense         = actual.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)
      const planned_income  = planned.filter(t => t.type === 'income').reduce((s, t)  => s + toEUR(t.amount, t.currency), 0)
      const planned_expense = planned.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)

      const accrued_salary = accruedByProject[p.id] ?? 0

      const totalIncome  = income + planned_income
      const totalExpense = expense + planned_expense + accrued_salary
      const profit = totalIncome - totalExpense
      const margin = totalIncome > 0 ? Math.round((profit / totalIncome) * 100) : 0
      const roi    = totalExpense > 0 ? Math.round((profit / totalExpense) * 100) : 0

      return { id: p.id, name: p.name, income, expense, accrued_salary, planned_income, planned_expense, profit, margin, roi }
    })

    setProjects(stats.sort((a, b) => b.profit - a.profit))
  }

  async function fetchDetail(projectId: string) {
    if (details[projectId]) return
    setLoading(projectId)

    const { data: txs } = await supabase
      .from('transactions')
      .select(`id, date, type, amount, currency, comment, is_planned,
        counterparty:counterparties(name),
        category:categories(name)`)
      .eq('project_id', projectId)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true })

    if (!txs) { setLoading(null); return }

    // Monthly chart data (amounts in USD)
    const monthly: MonthPoint[] = MONTHS.map((m, i) => {
      const mo = txs.filter(t => new Date(t.date).getMonth() === i)
      return {
        month: m,
        income:  mo.filter(t => t.type === 'income').reduce((s, t)  => s + toEUR(t.amount, t.currency), 0),
        expense: mo.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0),
      }
    }).filter(m => m.income > 0 || m.expense > 0)

    // By person (counterparty or extracted from comment) — amounts in USD
    const personMap: Record<string, ByPerson> = {}
    for (const t of txs) {
      const raw = (t.counterparty as { name?: string } | null)?.name
      let name = raw ?? ''
      if (!name && t.comment) {
        const match = t.comment.match(/ЗП\s+(.+?)\s*—/)
        name = match ? match[1] : t.comment.slice(0, 30)
      }
      if (!name) name = 'Без контрагента'
      if (!personMap[name]) personMap[name] = { name, income: 0, expense: 0, profit: 0 }
      const amtUSD = toEUR(t.amount, t.currency)
      if (t.type === 'income')  personMap[name].income  += amtUSD
      if (t.type === 'expense') personMap[name].expense += amtUSD
    }
    Object.values(personMap).forEach(p => { p.profit = p.income - p.expense })

    setDetails(d => ({ ...d, [projectId]: {
      monthly,
      byPerson: Object.values(personMap).sort((a, b) => b.expense - a.expense),
      transactions: txs as unknown as TxRow[],
    }}))
    setLoading(null)
  }

  function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    fetchDetail(id)
  }

  // ── Project management actions ──────────────────────────────────────────────

  async function toggleStatus(p: Project) {
    await supabase.from('projects')
      .update({ status: p.status === 'active' ? 'inactive' : 'active' })
      .eq('id', p.id)
    fetchSummary()
  }

  async function archiveProject(p: Project) {
    await supabase.from('projects')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', p.id)
    fetchSummary()
  }

  async function unarchiveProject(p: Project) {
    await supabase.from('projects')
      .update({ status: 'active', archived_at: null })
      .eq('id', p.id)
    fetchSummary()
  }

  async function deleteProject(id: string) {
    if (!confirm('Видалити проект назавжди? Транзакції залишаться, але без привʼязки до проекту.')) return
    await supabase.from('projects').delete().eq('id', id)
    fetchSummary()
  }

  const totalIncome  = projects.reduce((s, p) => s + p.income + p.planned_income, 0)
  const totalExpense = projects.reduce((s, p) => s + p.expense + p.planned_expense + p.accrued_salary, 0)
  const totalProfit  = totalIncome - totalExpense

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Проекти</h1>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)}
              className="rounded" />
            Планові
          </label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={14} /> Новий проект
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Загальний дохід',  value: totalIncome,  color: 'text-teal-600',  icon: TrendingUp },
          { label: 'Загальні витрати', value: totalExpense, color: 'text-red-500',   icon: TrendingDown },
          { label: 'Прибуток',         value: totalProfit,  color: totalProfit >= 0 ? 'text-teal-600' : 'text-red-500', icon: DollarSign },
        ].map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon size={15} className="text-gray-400" />
              <p className="text-xs text-gray-400">{k.label}</p>
            </div>
            <p className={`text-xl font-bold ${k.color}`}>{fmt(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium w-8"></th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Назва</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Доходи</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Витрати</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Прибуток</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Маржа %</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">ROI %</th>
              <th className="py-3 px-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">Немає проектів</td></tr>
            )}
            {projects.map(p => {
              const raw = rawById[p.id]
              const totalInc = p.income + (showPlanned ? p.planned_income : 0)
              const totalExp = p.expense + p.accrued_salary + (showPlanned ? p.planned_expense : 0)
              const profit   = totalInc - totalExp
              const margin   = totalInc > 0 ? Math.round((profit / totalInc) * 100) : 0
              const roi      = totalExp > 0 ? Math.round((profit / totalExp) * 100) : 0
              const isOpen   = expanded === p.id
              const det      = details[p.id]
              const sym      = CURRENCY_SYMBOL[raw?.contract_currency ?? 'USD']

              return (
                <>
                  <tr
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className="border-b border-gray-50 hover:bg-gray-50/70 cursor-pointer group"
                  >
                    <td className="py-3 px-4 text-gray-400">
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: raw?.color ?? '#14b8a6' }} />
                        <div>
                          <span className="font-medium text-gray-800">{p.name}</span>
                          {(raw?.contract_amount ?? 0) > 0 && (
                            <p className="text-[11px] text-gray-400">
                              Контракт: {sym}{raw!.contract_amount!.toLocaleString('en-US')}
                              {(raw?.received_before_app ?? 0) > 0 && (
                                <span className="text-teal-600"> · до старту: {sym}{raw!.received_before_app!.toLocaleString('en-US')}</span>
                              )}
                            </p>
                          )}
                        </div>
                        {raw && (
                          <button
                            onClick={e => { e.stopPropagation(); toggleStatus(raw) }}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
                              raw.status === 'active'
                                ? 'border-teal-200 text-teal-600 hover:bg-teal-50'
                                : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                            }`}
                          >
                            {raw.status === 'active' ? 'Активний' : 'Неактивний'}
                          </button>
                        )}
                        <a
                          href={`/board/${p.id}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-[11px] bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full hover:bg-teal-50 hover:text-teal-600 hover:border-teal-200 transition-colors flex-shrink-0"
                        >
                          <LayoutDashboard size={9} /> Борда
                        </a>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-teal-600">{fmt(totalInc)}</td>
                    <td className="py-3 px-4 text-right text-red-500">
                      {fmt(totalExp)}
                      {p.accrued_salary > 0 && (
                        <p className="text-[10px] text-gray-400 font-normal">
                          у т.ч. нараховано ЗП: {fmt(p.accrued_salary)}
                        </p>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-semibold ${profit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                      {fmt(profit)}
                    </td>
                    <td className={`py-3 px-4 text-right ${margin >= 0 ? 'text-gray-700' : 'text-red-400'}`}>
                      {margin}%
                    </td>
                    <td className={`py-3 px-4 text-right ${roi >= 0 ? 'text-gray-700' : 'text-red-400'}`}>
                      {roi}%
                    </td>
                    <td className="py-3 px-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <button onClick={() => raw && setEditProject(raw)} className="text-gray-400 hover:text-gray-700 p-1.5 rounded" title="Редагувати">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => raw && archiveProject(raw)} className="text-gray-400 hover:text-amber-500 p-1.5 rounded" title="Архівувати">
                          <Archive size={13} />
                        </button>
                        <button onClick={() => deleteProject(p.id)} className="text-gray-400 hover:text-red-400 p-1.5 rounded" title="Видалити">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`${p.id}-detail`} className="bg-gray-50/50 border-b border-gray-100">
                      <td colSpan={8} className="px-6 py-5">
                        {loading === p.id ? (
                          <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>
                        ) : det ? (
                          <div className="flex flex-col gap-6">

                            {/* KPI strip */}
                            <div className="grid grid-cols-4 gap-3">
                              {[
                                { label: 'Дохід',   val: fmt(totalInc), color: 'text-teal-600' },
                                { label: 'Витрати', val: fmt(totalExp), color: 'text-red-500'  },
                                { label: 'Маржа',   val: margin + '%',  color: margin >= 0 ? 'text-teal-600' : 'text-red-500' },
                                { label: 'ROI',     val: roi + '%',     color: roi >= 0 ? 'text-teal-600' : 'text-red-500' },
                              ].map(k => (
                                <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                                  <p className="text-xs text-gray-400 mb-1">{k.label}</p>
                                  <p className={`text-lg font-bold ${k.color}`}>{k.val}</p>
                                </div>
                              ))}
                            </div>

                            {/* Admin notes: what the payments were for, agreements */}
                            <ProjectNotes projectId={p.id} initial={rawById[p.id]?.notes ?? ''} />

                            {/* Accrued (unpaid) tracker salary */}
                            {p.accrued_salary > 0 && (
                              <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5">
                                <p className="text-xs text-amber-700 font-medium">Нараховано ЗП (не виплачено)</p>
                                <p className="text-sm font-bold text-amber-700">{fmt(p.accrued_salary)}</p>
                              </div>
                            )}

                            {/* Chart */}
                            {det.monthly.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">По місяцях</p>
                                <ResponsiveContainer width="100%" height={200}>
                                  <AreaChart data={det.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                      <linearGradient id="projIncome" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.35} />
                                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                                      </linearGradient>
                                      <linearGradient id="projExpense" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                                      </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <Tooltip formatter={(v) => fmt(Number(v))} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Area type="monotone" dataKey="income"  name="Дохід"   stroke="#14b8a6" strokeWidth={2.5} fill="url(#projIncome)"  dot={false} activeDot={{ r: 4 }} />
                                    <Area type="monotone" dataKey="expense" name="Витрати" stroke="#f87171" strokeWidth={2.5} fill="url(#projExpense)" dot={false} activeDot={{ r: 4 }} />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            )}

                            {/* By person */}
                            {det.byPerson.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">По співробітниках / контрагентах</p>
                                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="text-left py-2 px-4 text-gray-400 font-medium">Імʼя</th>
                                        <th className="text-right py-2 px-4 text-gray-400 font-medium">Дохід</th>
                                        <th className="text-right py-2 px-4 text-gray-400 font-medium">Витрати</th>
                                        <th className="text-right py-2 px-4 text-gray-400 font-medium">Прибуток</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {det.byPerson.map(bp => (
                                        <tr key={bp.name} className="border-b border-gray-50">
                                          <td className="py-2 px-4 font-medium text-gray-700">{bp.name}</td>
                                          <td className="py-2 px-4 text-right text-teal-600">{fmt(bp.income)}</td>
                                          <td className="py-2 px-4 text-right text-red-500">{fmt(bp.expense)}</td>
                                          <td className={`py-2 px-4 text-right font-medium ${bp.profit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                                            {fmt(bp.profit)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Transactions list */}
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Всі транзакції</p>
                              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left py-2 px-4 text-gray-400 font-medium">Дата</th>
                                      <th className="text-left py-2 px-4 text-gray-400 font-medium">Коментар</th>
                                      <th className="text-left py-2 px-4 text-gray-400 font-medium">Категорія</th>
                                      <th className="text-right py-2 px-4 text-gray-400 font-medium">Сума</th>
                                      <th className="text-right py-2 px-4 text-gray-400 font-medium">Статус</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {det.transactions.map(t => (
                                      <tr key={t.id} className="border-b border-gray-50">
                                        <td className="py-2 px-4 text-gray-500 whitespace-nowrap">
                                          {new Date(t.date).toLocaleDateString('uk-UA')}
                                        </td>
                                        <td className="py-2 px-4 text-gray-700 max-w-xs truncate">
                                          {t.comment || '—'}
                                        </td>
                                        <td className="py-2 px-4 text-gray-500">
                                          {(t.category as { name?: string } | null)?.name || '—'}
                                        </td>
                                        <td className={`py-2 px-4 text-right font-medium whitespace-nowrap ${t.type === 'income' ? 'text-teal-600' : 'text-red-500'}`}>
                                          {t.type === 'income' ? '+' : '−'}{fmt(toEUR(t.amount, t.currency))}
                                          {t.currency !== 'USD' && <span className="text-xs text-gray-400 ml-1">({t.currency})</span>}
                                        </td>
                                        <td className="py-2 px-4 text-right">
                                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.is_planned ? 'bg-amber-50 text-amber-600' : 'bg-teal-50 text-teal-600'}`}>
                                            {t.is_planned ? 'план' : 'факт'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Archived projects */}
      {archived.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowArchived(v => !v)}
            className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1.5 mb-3 transition-colors">
            <Archive size={14} className="text-amber-400" />
            {showArchived ? 'Сховати' : 'Показати'} архів ({archived.length})
          </button>
          {showArchived && (
            <div className="flex flex-col gap-2">
              {archived.map(p => (
                <div key={p.id}
                  className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50 group opacity-70 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-3 min-w-0">
                    <Archive size={13} className="text-amber-400 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-gray-700">{p.name}</span>
                      {p.archived_at && (
                        <p className="text-xs text-gray-400">
                          Архівовано {new Date(p.archived_at).toLocaleDateString('uk-UA')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => unarchiveProject(p)}
                      className="text-xs text-gray-500 hover:text-teal-600 px-2 py-1 rounded border border-gray-200 hover:border-teal-200 transition-colors">
                      Відновити
                    </button>
                    <button onClick={() => deleteProject(p.id)}
                      className="text-gray-400 hover:text-red-400 p-1.5 rounded" title="Видалити назавжди">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / edit project modals */}
      {addOpen && (
        <ProjectModal
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); fetchSummary() }}
        />
      )}
      {editProject && (
        <ProjectModal
          project={editProject}
          onClose={() => setEditProject(null)}
          onSuccess={() => { setEditProject(null); fetchSummary() }}
        />
      )}
    </div>
  )
}

// ── Per-project admin notes with autosave ───────────────────────────────────────

function ProjectNotes({ projectId, initial }: { projectId: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setValue(initial) }, [projectId])

  async function save() {
    const text = value.trim()
    if (text === (initial ?? '').trim() && savedAt === null) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ notes: text || null })
      .eq('id', projectId)
    setSaving(false)
    if (!error) {
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2000)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Нотатки</p>
        {saving && <span className="text-[10px] text-gray-400">Зберігаю...</span>}
        {savedAt && <span className="text-[10px] text-teal-600">Збережено ✓</span>}
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="За що оплати, домовленості з клієнтом, деталі контракту..."
        className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y leading-relaxed placeholder-gray-300"
      />
    </div>
  )
}
