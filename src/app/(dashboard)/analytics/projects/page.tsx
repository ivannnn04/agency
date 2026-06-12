'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { ArrowLeft, ChevronDown, ChevronUp, TrendingUp, TrendingDown, DollarSign, Edit2, X } from 'lucide-react'
import Link from 'next/link'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

interface ProjectStats {
  id: string
  name: string
  status: string
  income: number
  expense: number
  planned_income: number
  planned_expense: number
  received_before_app: number
  spent_before_app: number
  contract_amount: number | null
  contract_currency: string
  // raw values for edit modal
  raw_contract_amount: number | null
  raw_received_before_app: number
  raw_spent_before_app: number
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
const SYM: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function fmt(n: number) {
  return '₴' + Math.round(n).toLocaleString('uk-UA')
}

export default function AnalyticsProjectsPage() {
  const [projects, setProjects]       = useState<ProjectStats[]>([])
  const [year, setYear]               = useState(new Date().getFullYear())
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [details, setDetails]         = useState<Record<string, Detail>>({})
  const [loadingId, setLoadingId]     = useState<string | null>(null)
  const [showPlanned, setShowPlanned] = useState(true)
  const [editProject, setEditProject] = useState<ProjectStats | null>(null)
  const { toUAH, loading: ratesLoading } = useRates()

  useEffect(() => { if (!ratesLoading) fetchSummary() }, [year, ratesLoading])

  async function fetchSummary() {
    const { data: projs } = await supabase
      .from('projects')
      .select('id, name, status, contract_amount, contract_currency, received_before_app, spent_before_app')
    const { data: txs } = await supabase
      .from('transactions')
      .select('type, amount, currency, project_id, is_planned')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)

    if (!projs || !txs) return

    const stats = projs.map(p => {
      const ptxs = txs.filter(t => t.project_id === p.id)
      const actual  = ptxs.filter(t => !t.is_planned)
      const planned = ptxs.filter(t => t.is_planned)

      const cur = p.contract_currency ?? 'USD'

      const txIncome        = actual.filter(t => t.type === 'income').reduce((s, t)  => s + toUAH(t.amount, t.currency), 0)
      const txExpense       = actual.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      const planned_income  = planned.filter(t => t.type === 'income').reduce((s, t)  => s + toUAH(t.amount, t.currency), 0)
      const planned_expense = planned.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)

      const received_before_app = toUAH(p.received_before_app ?? 0, cur)
      const spent_before_app    = toUAH(p.spent_before_app    ?? 0, cur)

      const income  = txIncome  + received_before_app
      const expense = txExpense + spent_before_app

      const totalIncome  = income + planned_income
      const totalExpense = expense + planned_expense
      const profit = totalIncome - totalExpense
      const margin = totalIncome  > 0 ? Math.round((profit / totalIncome)  * 100) : 0
      const roi    = totalExpense > 0 ? Math.round((profit / totalExpense) * 100) : 0

      const contract_amount = p.contract_amount ? toUAH(p.contract_amount, cur) : null

      return {
        id: p.id, name: p.name, status: p.status,
        income, expense, planned_income, planned_expense,
        received_before_app, spent_before_app,
        contract_amount, contract_currency: cur,
        raw_contract_amount: p.contract_amount,
        raw_received_before_app: p.received_before_app ?? 0,
        raw_spent_before_app: p.spent_before_app ?? 0,
        profit, margin, roi,
      }
    })

    setProjects(stats.sort((a, b) => b.profit - a.profit))
  }

  async function fetchDetail(projectId: string) {
    if (details[projectId]) return
    setLoadingId(projectId)

    const { data: txs } = await supabase
      .from('transactions')
      .select(`id, date, type, amount, currency, comment, is_planned,
        counterparty:counterparties(name),
        category:categories(name)`)
      .eq('project_id', projectId)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true })

    if (!txs) { setLoadingId(null); return }

    const monthly: MonthPoint[] = MONTHS.map((m, i) => {
      const mo = txs.filter(t => new Date(t.date).getMonth() === i)
      return {
        month: m,
        income:  mo.filter(t => t.type === 'income').reduce((s, t)  => s + toUAH(t.amount, t.currency), 0),
        expense: mo.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0),
      }
    }).filter(m => m.income > 0 || m.expense > 0)

    // Prepend pre-app amounts as a "до старту" data point
    const proj = projects.find(p => p.id === projectId)
    if (proj && (proj.received_before_app > 0 || proj.spent_before_app > 0)) {
      monthly.unshift({
        month: 'до старту',
        income:  proj.received_before_app,
        expense: proj.spent_before_app,
      })
    }

    const personMap: Record<string, ByPerson> = {}
    for (const t of txs) {
      const raw = (t.counterparty as any)?.name
      let name = raw ?? ''
      if (!name && t.comment) {
        const match = t.comment.match(/ЗП\s+(.+?)\s*—/)
        name = match ? match[1] : t.comment.slice(0, 30)
      }
      if (!name) name = 'Без контрагента'
      if (!personMap[name]) personMap[name] = { name, income: 0, expense: 0, profit: 0 }
      const amtUSD = toUAH(t.amount, t.currency)
      if (t.type === 'income')  personMap[name].income  += amtUSD
      if (t.type === 'expense') personMap[name].expense += amtUSD
    }
    Object.values(personMap).forEach(p => { p.profit = p.income - p.expense })

    setDetails(d => ({ ...d, [projectId]: {
      monthly,
      byPerson: Object.values(personMap).sort((a, b) => b.expense - a.expense),
      transactions: txs as unknown as TxRow[],
    }}))
    setLoadingId(null)
  }

  function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    fetchDetail(id)
  }

  const totalIncome  = projects.reduce((s, p) => s + p.income + p.planned_income, 0)
  const totalExpense = projects.reduce((s, p) => s + p.expense + p.planned_expense, 0)
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
            <input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)} className="rounded" />
            Планові
          </label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
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
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Контракт</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Доходи</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Витрати</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Прибуток</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Маржа %</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">ROI %</th>
              <th className="w-8 py-3 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Немає проектів</td></tr>
            )}
            {projects.map(p => {
              const totalInc = p.income + (showPlanned ? p.planned_income : 0)
              const totalExp = p.expense + (showPlanned ? p.planned_expense : 0)
              const profit   = totalInc - totalExp
              const margin   = totalInc  > 0 ? Math.round((profit / totalInc)  * 100) : 0
              const roi      = totalExp  > 0 ? Math.round((profit / totalExp)  * 100) : 0
              const isOpen   = expanded === p.id
              const det      = details[p.id]
              const isArchived = p.status === 'archived'
              const hasPreApp  = p.received_before_app > 0 || p.spent_before_app > 0

              return (
                <>
                  <tr
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`border-b border-gray-50 hover:bg-gray-50/70 cursor-pointer ${isArchived ? 'opacity-60' : ''}`}
                  >
                    <td className="py-3 px-4 text-gray-400">
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.name}
                        {isArchived && <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">архів</span>}
                        {hasPreApp && <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full">до старту</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-400 text-xs">
                      {p.contract_amount ? fmt(p.contract_amount) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-teal-600">{fmt(totalInc)}</td>
                    <td className="py-3 px-4 text-right text-red-500">{fmt(totalExp)}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${profit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>{fmt(profit)}</td>
                    <td className={`py-3 px-4 text-right ${margin >= 0 ? 'text-gray-700' : 'text-red-400'}`}>{margin}%</td>
                    <td className={`py-3 px-4 text-right ${roi >= 0 ? 'text-gray-700' : 'text-red-400'}`}>{roi}%</td>
                    <td className="py-3 px-2">
                      <button
                        onClick={e => { e.stopPropagation(); setEditProject(p) }}
                        className="text-gray-300 hover:text-gray-600 p-1 rounded transition-colors"
                        title="Редагувати фінансові дані"
                      >
                        <Edit2 size={13} />
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`${p.id}-detail`} className="bg-gray-50/50 border-b border-gray-100">
                      <td colSpan={9} className="px-6 py-5">
                        {loadingId === p.id ? (
                          <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>
                        ) : det ? (
                          <div className="flex flex-col gap-6">

                            {/* KPI strip */}
                            <div className={`grid gap-3 ${p.contract_amount ? 'grid-cols-5' : 'grid-cols-4'}`}>
                              {p.contract_amount && (
                                <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                                  <p className="text-xs text-gray-400 mb-1">Контракт</p>
                                  <p className="text-lg font-bold text-gray-700">{fmt(p.contract_amount)}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {Math.round((totalInc / p.contract_amount) * 100)}% отримано
                                  </p>
                                </div>
                              )}
                              {[
                                {
                                  label: 'Отримано', val: fmt(totalInc), color: 'text-teal-600',
                                  sub: p.received_before_app > 0 ? `до старту: ${fmt(p.received_before_app)}` : undefined,
                                },
                                {
                                  label: 'Витрати', val: fmt(totalExp), color: 'text-red-500',
                                  sub: p.spent_before_app > 0 ? `до старту: ${fmt(p.spent_before_app)}` : undefined,
                                },
                                { label: 'Маржа', val: margin + '%', color: margin >= 0 ? 'text-teal-600' : 'text-red-500', sub: undefined },
                                { label: 'ROI',   val: roi   + '%', color: roi   >= 0 ? 'text-teal-600' : 'text-red-500', sub: undefined },
                              ].map(k => (
                                <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                                  <p className="text-xs text-gray-400 mb-1">{k.label}</p>
                                  <p className={`text-lg font-bold ${k.color}`}>{k.val}</p>
                                  {k.sub && <p className="text-[10px] text-orange-400 mt-0.5">{k.sub}</p>}
                                </div>
                              ))}
                            </div>

                            {/* Chart */}
                            {det.monthly.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">По місяцях</p>
                                <ResponsiveContainer width="100%" height={200}>
                                  <BarChart data={det.monthly} barCategoryGap="30%">
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <Tooltip formatter={(v) => fmt(Number(v))} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="income"  name="Дохід"   fill="#14b8a6" radius={[4,4,0,0]} />
                                    <Bar dataKey="expense" name="Витрати" fill="#f87171" radius={[4,4,0,0]} />
                                  </BarChart>
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
                                        <th className="text-left py-2 px-4 text-gray-400 font-medium">Ім'я</th>
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

                            {/* Transactions */}
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Транзакції за {year}</p>
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
                                    {det.transactions.length === 0 && (
                                      <tr><td colSpan={5} className="text-center py-6 text-gray-400 text-xs">
                                        Немає транзакцій за {year}
                                        {(p.received_before_app > 0 || p.spent_before_app > 0) && ' (дані до старту не відображаються тут)'}
                                      </td></tr>
                                    )}
                                    {det.transactions.map(t => (
                                      <tr key={t.id} className="border-b border-gray-50">
                                        <td className="py-2 px-4 text-gray-500 whitespace-nowrap">
                                          {new Date(t.date).toLocaleDateString('uk-UA')}
                                        </td>
                                        <td className="py-2 px-4 text-gray-700 max-w-xs truncate">{t.comment || '—'}</td>
                                        <td className="py-2 px-4 text-gray-500">{(t.category as any)?.name || '—'}</td>
                                        <td className={`py-2 px-4 text-right font-medium whitespace-nowrap ${t.type === 'income' ? 'text-teal-600' : 'text-red-500'}`}>
                                          {t.type === 'income' ? '+' : '−'}{t.amount.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} {t.currency}
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

      {editProject && (
        <EditFinancialsModal
          project={editProject}
          onClose={() => setEditProject(null)}
          onSuccess={() => {
            setEditProject(null)
            setDetails({}) // clear cached details so they reload with new data
            fetchSummary()
          }}
        />
      )}
    </div>
  )
}

// ── Edit Financials Modal ──────────────────────────────────────────────────────

function EditFinancialsModal({ project: p, onClose, onSuccess }: {
  project: ProjectStats
  onClose: () => void
  onSuccess: () => void
}) {
  const sym = SYM[p.contract_currency] ?? '$'

  const [contractAmount,    setContractAmount]    = useState(p.raw_contract_amount != null ? String(p.raw_contract_amount) : '')
  const [contractCurrency,  setContractCurrency]  = useState(p.contract_currency)
  const [receivedBeforeApp, setReceivedBeforeApp] = useState(p.raw_received_before_app > 0 ? String(p.raw_received_before_app) : '')
  const [spentBeforeApp,    setSpentBeforeApp]    = useState(p.raw_spent_before_app    > 0 ? String(p.raw_spent_before_app)    : '')
  const [error, setError]  = useState('')
  const [saving, setSaving] = useState(false)

  const curSym = SYM[contractCurrency] ?? '$'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error: err } = await supabase.from('projects').update({
      contract_amount:    contractAmount    ? Number(contractAmount)    : null,
      contract_currency:  contractCurrency,
      received_before_app: receivedBeforeApp ? Number(receivedBeforeApp) : 0,
      spent_before_app:    spentBeforeApp    ? Number(spentBeforeApp)    : 0,
    }).eq('id', p.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Фінансові дані проекту</h2>
            <p className="text-xs text-gray-400 mt-0.5">{p.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="p-5 flex flex-col gap-5">

          {/* Contract */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Контракт</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Сума контракту</label>
                <input type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="0.00" value={contractAmount} onChange={e => setContractAmount(e.target.value)} />
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  value={contractCurrency} onChange={e => setContractCurrency(e.target.value)}>
                  <option>USD</option><option>EUR</option><option>UAH</option>
                </select>
              </div>
            </div>
          </div>

          {/* Pre-app amounts */}
          <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-4 border border-blue-100">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
              Дані до старту програми
            </p>
            <p className="text-[11px] text-blue-500 -mt-2">
              Ці суми враховуються в аналітиці але не впливають на рахунки
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Вже отримано від клієнта</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{curSym}</span>
                <input type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  placeholder="0.00" value={receivedBeforeApp} onChange={e => setReceivedBeforeApp(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Вже витрачено по проекту</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{curSym}</span>
                <input type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  placeholder="0.00" value={spentBeforeApp} onChange={e => setSpentBeforeApp(e.target.value)} autoFocus />
              </div>
            </div>

            {/* Live preview */}
            {(receivedBeforeApp || spentBeforeApp || contractAmount) && (
              <div className="bg-white rounded-lg border border-blue-100 px-3 py-2 text-xs flex flex-col gap-1">
                {contractAmount && <div className="flex justify-between text-gray-500"><span>Контракт</span><span className="font-medium text-gray-700">{curSym}{Number(contractAmount).toLocaleString('en-US')}</span></div>}
                {receivedBeforeApp && <div className="flex justify-between text-gray-500"><span>Отримано</span><span className="font-medium text-teal-600">+{curSym}{Number(receivedBeforeApp).toLocaleString('en-US')}</span></div>}
                {spentBeforeApp && <div className="flex justify-between text-gray-500"><span>Витрачено</span><span className="font-medium text-red-500">−{curSym}{Number(spentBeforeApp).toLocaleString('en-US')}</span></div>}
                {receivedBeforeApp && spentBeforeApp && (
                  <div className="flex justify-between border-t border-gray-100 pt-1 mt-0.5">
                    <span className="text-gray-500">Прибуток</span>
                    <span className={`font-semibold ${Number(receivedBeforeApp) - Number(spentBeforeApp) >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                      {Number(receivedBeforeApp) - Number(spentBeforeApp) >= 0 ? '+' : ''}{curSym}{(Number(receivedBeforeApp) - Number(spentBeforeApp)).toLocaleString('en-US')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
