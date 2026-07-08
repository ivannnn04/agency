'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import {
  TrendingUp, BarChart2, ArrowDownCircle, ArrowUpCircle,
  FileText, FolderOpen, Scale, Target, Activity,
  Wallet, Clock, PiggyBank,
} from 'lucide-react'

const reports = [
  { href: '/analytics/cash-flow',         icon: TrendingUp,      title: 'Гроші / Cash flow',   description: 'Звіт про рух грошових коштів' },
  { href: '/analytics/pl',                icon: BarChart2,       title: 'P&L',                 description: 'Звіт про прибутки і збитки' },
  { href: '/analytics/projects',          icon: FolderOpen,      title: 'Проекти',             description: 'Дохід, витрати та маржа по проектах' },
  { href: '/analytics/receivables',       icon: ArrowDownCircle, title: 'Дебіторка',           description: 'Розгорнута дебіторська заборгованість' },
  { href: '/analytics/payables',          icon: ArrowUpCircle,   title: 'Кредиторка',          description: 'Розгорнута кредиторська заборгованість' },
  { href: '/analytics/statement',         icon: FileText,        title: 'Виписка за рахунком', description: 'Звіт з банківських рахунків' },
  { href: '/analytics/balance',           icon: Scale,           title: 'Баланс',              description: 'Звіт про активи та пасиви' },
  { href: '/analytics/plan-fact',         icon: Target,          title: 'План/Факт',           description: 'Порівняння планових і фактичних результатів' },
  { href: '/analytics/financial-metrics', icon: Activity,        title: 'Фінансові показники', description: 'EBITDA, маржа та рентабельність' },
]

interface ProjectRow {
  id: string
  name: string
  status: string
  contractUSD: number
  receivedUSD: number
  remainingUSD: number
  currency: string
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export default function AnalyticsPage() {
  const { toUSD, fmtUSD, loading: ratesLoading } = useRates()
  const [onAccounts, setOnAccounts] = useState(0)
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [yearIncome, setYearIncome] = useState(0)
  const [yearExpense, setYearExpense] = useState(0)
  const [loading, setLoading] = useState(true)
  const year = new Date().getFullYear()

  useEffect(() => { if (!ratesLoading) fetchData() }, [ratesLoading])

  async function fetchData() {
    setLoading(true)

    const [{ data: accounts }, { data: projects }, { data: txs }] = await Promise.all([
      supabase.from('accounts').select('balance, currency'),
      supabase.from('projects').select('id, name, status, contract_amount, contract_currency, received_before_app').neq('status', 'archived'),
      supabase.from('transactions').select('type, amount, currency, project_id, is_planned, date'),
    ])

    // Total on accounts (USD)
    setOnAccounts((accounts ?? []).reduce((s, a) => s + toUSD(a.balance ?? 0, a.currency), 0))

    // Actual income received per project (all-time)
    const incomeByProject: Record<string, number> = {}
    let yIncome = 0, yExpense = 0
    for (const t of txs ?? []) {
      if (t.is_planned) continue
      const usd = toUSD(t.amount, t.currency)
      const inYear = String(t.date).slice(0, 4) === String(year)
      if (t.type === 'income') {
        if (t.project_id) incomeByProject[t.project_id] = (incomeByProject[t.project_id] ?? 0) + usd
        if (inYear) yIncome += usd
      } else if (t.type === 'expense' && inYear) {
        yExpense += usd
      }
    }
    setYearIncome(yIncome)
    setYearExpense(yExpense)

    // Project contract rows
    const projectRows: ProjectRow[] = (projects ?? [])
      .filter(p => (p.contract_amount ?? 0) > 0)
      .map(p => {
        const cur = p.contract_currency ?? 'USD'
        const contractUSD = toUSD(p.contract_amount ?? 0, cur)
        const receivedBefore = toUSD(p.received_before_app ?? 0, cur)
        const receivedUSD = receivedBefore + (incomeByProject[p.id] ?? 0)
        const remainingUSD = Math.max(0, contractUSD - receivedUSD)
        return {
          id: p.id, name: p.name, status: p.status,
          contractUSD, receivedUSD, remainingUSD, currency: cur,
        }
      })
      .sort((a, b) => b.remainingUSD - a.remainingUSD)

    setRows(projectRows)
    setLoading(false)
  }

  const totalContract  = rows.reduce((s, r) => s + r.contractUSD, 0)
  const totalReceived  = rows.reduce((s, r) => s + r.receivedUSD, 0)
  const totalRemaining = rows.reduce((s, r) => s + r.remainingUSD, 0)
  const yearProfit = yearIncome - yearExpense

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Аналітика</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <Wallet size={16} /><span className="text-xs font-medium uppercase tracking-wide">Всього на рахунках</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? '…' : fmtUSD(onAccounts)}</p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-amber-500 mb-2">
            <Clock size={16} /><span className="text-xs font-medium uppercase tracking-wide">Має надійти з проєктів</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{loading ? '…' : fmtUSD(totalRemaining)}</p>
          <p className="text-xs text-amber-500/70 mt-1">за {rows.length} контрактами</p>
        </div>

        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-teal-500 mb-2">
            <PiggyBank size={16} /><span className="text-xs font-medium uppercase tracking-wide">Прибуток за {year}</span>
          </div>
          <p className={`text-2xl font-bold ${yearProfit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
            {loading ? '…' : fmtUSD(yearProfit)}
          </p>
          <p className="text-xs text-teal-600/60 mt-1">
            дохід {fmtUSD(yearIncome)} · витрати {fmtUSD(yearExpense)}
          </p>
        </div>
      </div>

      {/* Projects — money to receive */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Надходження по проєктах</h2>
          <Link href="/analytics/projects" className="text-xs text-teal-600 hover:text-teal-700">Детальна маржа →</Link>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm py-8 text-center">Завантаження...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border border-gray-100">
            <FolderOpen size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Немає проєктів із заповненою сумою контракту</p>
            <p className="text-xs mt-1">Додайте суму контракту в проєкті, щоб бачити надходження</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Проєкт</th>
                  <th className="text-right px-4 py-3 font-medium">Контракт</th>
                  <th className="text-right px-4 py-3 font-medium">Отримано</th>
                  <th className="text-right px-4 py-3 font-medium">Залишок</th>
                  <th className="px-4 py-3 w-40 font-medium">Прогрес</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const pct = r.contractUSD > 0 ? Math.min(100, (r.receivedUSD / r.contractUSD) * 100) : 0
                  const done = r.remainingUSD <= 0.5
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmtUSD(r.contractUSD)}</td>
                      <td className="px-4 py-3 text-right text-teal-600">{fmtUSD(r.receivedUSD)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${done ? 'text-gray-300' : 'text-amber-600'}`}>
                        {done ? '✓' : fmtUSD(r.remainingUSD)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${done ? 'bg-teal-400' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold text-gray-900">
                  <td className="px-4 py-3">Разом</td>
                  <td className="px-4 py-3 text-right">{fmtUSD(totalContract)}</td>
                  <td className="px-4 py-3 text-right text-teal-600">{fmtUSD(totalReceived)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{fmtUSD(totalRemaining)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Detailed reports */}
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Детальні звіти</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <Link
              key={report.href}
              href={report.href}
              className="border border-gray-200 rounded-xl p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
            >
              <Icon size={22} className="text-gray-400 group-hover:text-teal-500 mb-3 transition-colors" />
              <h3 className="font-semibold text-gray-800 mb-1 text-sm">{report.title}</h3>
              <p className="text-xs text-gray-500">{report.description}</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
