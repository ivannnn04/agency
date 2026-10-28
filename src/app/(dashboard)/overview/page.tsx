'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, Percent, Users, Send, Clock,
  FolderKanban, ArrowRight,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// CEO overview: the whole agency on one screen — cash, this month's P&L,
// 6-month cashflow, top projects, the lead funnel, outreach and team load.

interface MonthPoint { month: string; income: number; expense: number }

const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const LEAD_COLUMNS: { key: string; label: string; cls: string }[] = [
  { key: 'new', label: 'Нові', cls: 'bg-gray-100 text-gray-700' },
  { key: 'contacted', label: 'Контакт', cls: 'bg-blue-50 text-blue-700' },
  { key: 'negotiation', label: 'Переговори', cls: 'bg-amber-50 text-amber-700' },
  { key: 'proposal', label: 'Пропозиція', cls: 'bg-violet-50 text-violet-700' },
  { key: 'won', label: 'Виграли', cls: 'bg-teal-50 text-teal-700' },
]

function fmt(n: number) {
  return '€' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function CeoOverviewPage() {
  const { toEUR, loading: ratesLoading } = useRates()
  const [accountsTotal, setAccountsTotal] = useState(0)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthExpense, setMonthExpense] = useState(0)
  const [cashflow, setCashflow] = useState<MonthPoint[]>([])
  const [topProjects, setTopProjects] = useState<{ id: string; name: string; profit: number; income: number }[]>([])
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({})
  const [outreach, setOutreach] = useState({ week: 0, replied: 0, won: 0 })
  const [teamHours, setTeamHours] = useState(0)
  const [teamActive, setTeamActive] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)

    const [accounts, txs, projs, leads, proposals, entries] = await Promise.all([
      supabase.from('accounts').select('balance, currency'),
      supabase.from('transactions')
        .select('type, amount, currency, project_id, date, is_planned')
        .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
        .neq('type', 'transfer'),
      supabase.from('projects').select('id, name, status'),
      supabase.from('crm_leads').select('status'),
      supabase.from('outreach_proposals').select('status, sent_at'),
      supabase.from('time_entries')
        .select('team_member_id, duration_seconds')
        .gte('started_at', monthStart.toISOString())
        .not('ended_at', 'is', null),
    ])

    setAccountsTotal((accounts.data ?? []).reduce((s, a) => s + toEUR(a.balance, a.currency), 0))

    const actual = (txs.data ?? []).filter(t => !t.is_planned)
    const inMonth = actual.filter(t => new Date(t.date) >= monthStart)
    setMonthIncome(inMonth.filter(t => t.type === 'income').reduce((s, t) => s + toEUR(t.amount, t.currency), 0))
    setMonthExpense(inMonth.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0))

    // 6-month cashflow
    const points: MonthPoint[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const mo = actual.filter(t => { const td = new Date(t.date); return td >= d && td < next })
      points.push({
        month: MONTHS[d.getMonth()],
        income: Math.round(mo.filter(t => t.type === 'income').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)),
        expense: Math.round(mo.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)),
      })
    }
    setCashflow(points)

    // Top projects by profit over the window
    const nameById: Record<string, string> = {}
    for (const p of projs.data ?? []) nameById[p.id] = p.name
    const byProject: Record<string, { income: number; expense: number }> = {}
    for (const t of actual) {
      if (!t.project_id || !nameById[t.project_id]) continue
      const b = byProject[t.project_id] ?? (byProject[t.project_id] = { income: 0, expense: 0 })
      if (t.type === 'income') b.income += toEUR(t.amount, t.currency)
      else if (t.type === 'expense') b.expense += toEUR(t.amount, t.currency)
    }
    setTopProjects(
      Object.entries(byProject)
        .map(([id, b]) => ({ id, name: nameById[id], income: b.income, profit: b.income - b.expense }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5)
    )

    const lc: Record<string, number> = {}
    for (const l of leads.data ?? []) lc[l.status] = (lc[l.status] ?? 0) + 1
    setLeadCounts(lc)

    const props = proposals.data ?? []
    setOutreach({
      week: props.filter(p => new Date(p.sent_at) > weekAgo).length,
      replied: props.filter(p => p.status === 'replied').length,
      won: props.filter(p => p.status === 'won').length,
    })

    const secs = (entries.data ?? []).reduce((s, e) => s + (e.duration_seconds ?? 0), 0)
    setTeamHours(Math.round(secs / 3600))
    setTeamActive(new Set((entries.data ?? []).map(e => e.team_member_id)).size)

    setLoading(false)
  }, [toEUR])

  useEffect(() => { if (!ratesLoading) load() }, [ratesLoading, load])

  const profit = monthIncome - monthExpense
  const margin = monthIncome > 0 ? Math.round((profit / monthIncome) * 100) : 0
  const monthLabel = new Date().toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })

  const kpi = (icon: React.ReactNode, label: string, value: string, accent = '') => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 text-gray-400 mb-2">{icon}<span className="text-[11px]">{label}</span></div>
      <p className={`text-2xl font-bold ${accent || 'text-gray-900'}`}>{value}</p>
    </div>
  )

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">CEO огляд</h1>
      <p className="text-xs text-gray-400 mb-6 capitalize">{monthLabel}</p>

      {loading ? (
        <p className="text-sm text-gray-300 py-10">Рахуємо...</p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {kpi(<Wallet size={14} />, 'На рахунках', fmt(accountsTotal))}
            {kpi(<TrendingUp size={14} />, 'Дохід за місяць', fmt(monthIncome), 'text-teal-700')}
            {kpi(<TrendingDown size={14} />, 'Витрати за місяць', fmt(monthExpense), 'text-red-500')}
            {kpi(<PiggyBank size={14} />, 'Прибуток за місяць', fmt(profit), profit >= 0 ? 'text-gray-900' : 'text-red-500')}
            {kpi(<Percent size={14} />, 'Маржа', `${margin}%`)}
          </div>

          {/* Cashflow */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-900 mb-4">Кешфлоу, останні 6 місяців</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashflow} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ceoInc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ceoExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip formatter={(v) => fmt(Number(v ?? 0))} />
                  <Area type="monotone" dataKey="income" name="Дохід" stroke="#14b8a6" strokeWidth={2.5} fill="url(#ceoInc)" dot={false} />
                  <Area type="monotone" dataKey="expense" name="Витрати" stroke="#ef4444" strokeWidth={2} fill="url(#ceoExp)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* Top projects */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><FolderKanban size={15} className="text-gray-400" /> Топ проєктів за прибутком</p>
                <Link href="/analytics/projects" className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">всі <ArrowRight size={11} /></Link>
              </div>
              {topProjects.length === 0 ? (
                <p className="text-xs text-gray-300 py-4">Немає привʼязаних транзакцій</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {topProjects.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-300 w-4">{i + 1}</span>
                      <span className="text-sm text-gray-800 flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-gray-400">{fmt(p.income)}</span>
                      <span className={`text-sm font-semibold w-20 text-right ${p.profit >= 0 ? 'text-teal-700' : 'text-red-500'}`}>{fmt(p.profit)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lead funnel */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Users size={15} className="text-gray-400" /> Воронка лідів</p>
                <Link href="/leads" className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">дошка <ArrowRight size={11} /></Link>
              </div>
              <div className="flex flex-col gap-2">
                {LEAD_COLUMNS.map(c => (
                  <div key={c.key} className="flex items-center gap-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md w-28 text-center ${c.cls}`}>{c.label}</span>
                    <div className="flex-1 bg-gray-50 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-gray-900 rounded-full"
                        style={{ width: `${Math.min(100, (leadCounts[c.key] ?? 0) * 12)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-6 text-right">{leadCounts[c.key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Outreach */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Send size={15} className="text-gray-400" /> Аутріч</p>
                <Link href="/outreach" className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">таба <ArrowRight size={11} /></Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-2xl font-bold text-gray-900">{outreach.week}</p><p className="text-[11px] text-gray-400">пропозалів за 7 днів</p></div>
                <div><p className="text-2xl font-bold text-amber-600">{outreach.replied}</p><p className="text-[11px] text-gray-400">відповіли</p></div>
                <div><p className="text-2xl font-bold text-teal-700">{outreach.won}</p><p className="text-[11px] text-gray-400">виграли</p></div>
              </div>
            </div>

            {/* Team */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Clock size={15} className="text-gray-400" /> Команда цього місяця</p>
                <Link href="/payroll" className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">зарплата <ArrowRight size={11} /></Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-2xl font-bold text-gray-900">{teamHours}г</p><p className="text-[11px] text-gray-400">натрекано годин</p></div>
                <div><p className="text-2xl font-bold text-gray-900">{teamActive}</p><p className="text-[11px] text-gray-400">людей трекали час</p></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
