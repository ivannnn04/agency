'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ArrowLeft, Download } from 'lucide-react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const PALETTE = ['#14b8a6', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316']

type GroupMode = 'month' | 'quarter'

export default function CashFlowPage() {
  const [transactions, setTransactions] = useState<any[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [groupMode, setGroupMode] = useState<GroupMode>('month')
  const [includePlanned, setIncludePlanned] = useState(false)
  const { toUAH, loading: ratesLoading } = useRates()

  useEffect(() => {
    if (!ratesLoading) fetchData()
  }, [year, includePlanned, ratesLoading])

  async function fetchData() {
    let query = supabase
      .from('transactions')
      .select('type, amount, currency, date, comment, account:accounts!account_id(name), category:categories(name), counterparty:counterparties(name), project:projects(name)')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: false })

    if (!includePlanned) query = query.eq('is_planned', false)

    const { data } = await query
    setTransactions(data ?? [])
  }

  const activeTxs = useMemo(
    () => transactions.filter(t => t.type !== 'transfer'),
    [transactions]
  )

  const chartData = useMemo(() => {
    if (groupMode === 'quarter') {
      return Array.from({ length: 4 }, (_, i) => {
        const q = i + 1
        const qTxs = activeTxs.filter(t => {
          const m = new Date(t.date).getMonth() + 1
          return m >= (q - 1) * 3 + 1 && m <= q * 3
        })
        const income  = qTxs.filter(t => t.type === 'income').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
        const expense = qTxs.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
        return { name: `Q${q}`, Надходження: Math.round(income), Списання: Math.round(expense), Сальдо: Math.round(income - expense) }
      })
    }
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const mTxs = activeTxs.filter(t => new Date(t.date).getMonth() + 1 === m)
      const income  = mTxs.filter(t => t.type === 'income').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      const expense = mTxs.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      return {
        name: new Date(year, i, 1).toLocaleString('uk-UA', { month: 'short' }),
        Надходження: Math.round(income),
        Списання: Math.round(expense),
        Сальдо: Math.round(income - expense),
      }
    })
  }, [activeTxs, groupMode, year, toUAH])

  const incomeByCategory = useMemo(() => groupByCategory(activeTxs.filter(t => t.type === 'income'), toUAH), [activeTxs, toUAH])
  const expenseByCategory = useMemo(() => groupByCategory(activeTxs.filter(t => t.type === 'expense'), toUAH), [activeTxs, toUAH])

  const totalIncome  = incomeByCategory.reduce((s, c) => s + c.value, 0)
  const totalExpense = expenseByCategory.reduce((s, c) => s + c.value, 0)
  const saldo = totalIncome - totalExpense

  const fmt = (v: number) => `₴ ${Math.round(v).toLocaleString('uk-UA')}`

  function exportCSV() {
    const rows = [
      ['Дата', 'Тип', 'Сума', 'Валюта', 'Сума UAH', 'Рахунок', 'Контрагент', 'Категорія', 'Проект', 'Коментар'],
      ...activeTxs.map(t => [
        t.date,
        t.type === 'income' ? 'Дохід' : 'Витрата',
        t.amount.toString(),
        t.currency,
        Math.round(toUAH(t.amount, t.currency)).toString(),
        t.account?.name ?? '',
        t.counterparty?.name ?? '',
        t.category?.name ?? '',
        t.project?.name ?? '',
        t.comment ?? '',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cashflow_${year}.csv`
    a.click()
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Гроші</h1>
          <p className="text-sm text-gray-400">Звіт про рух грошових коштів · всі суми в ₴ UAH</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          {[2023, 2024, 2025, 2026].map(y => (
            <option key={y} value={y}>За {y} рік</option>
          ))}
        </select>

        <label className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer select-none hover:bg-gray-50">
          <input
            type="checkbox"
            checked={includePlanned}
            onChange={e => setIncludePlanned(e.target.checked)}
            className="rounded"
          />
          Враховувати планові
        </label>

        <div className="flex border border-gray-200 rounded-lg overflow-hidden text-sm">
          <button
            onClick={() => setGroupMode('month')}
            className={`px-3 py-2 ${groupMode === 'month' ? 'bg-gray-100 font-medium text-gray-800' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            По місяцях
          </button>
          <button
            onClick={() => setGroupMode('quarter')}
            className={`px-3 py-2 border-l border-gray-200 ${groupMode === 'quarter' ? 'bg-gray-100 font-medium text-gray-800' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            По кварталах
          </button>
        </div>

        <button
          onClick={exportCSV}
          className="ml-auto flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
        >
          <Download size={16} /> CSV
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Надходження</p>
          <p className="text-xl font-bold text-teal-600">{fmt(totalIncome)}</p>
        </div>
        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Списання</p>
          <p className="text-xl font-bold text-red-500">{fmt(totalExpense)}</p>
        </div>
        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Сальдо</p>
          <p className={`text-xl font-bold ${saldo >= 0 ? 'text-teal-600' : 'text-red-500'}`}>{fmt(saldo)}</p>
        </div>
      </div>

      {/* Area chart */}
      <div className="border border-gray-100 rounded-xl p-4 mb-6">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} width={45} />
            <Tooltip
              formatter={(v: any, name: any) => [fmt(Number(v)), name]}
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
            />
            <Area type="monotone" dataKey="Надходження" stroke="#14b8a6" strokeWidth={2.5} fill="url(#gradIncome)" dot={false} activeDot={{ r: 4 }} />
            <Area type="monotone" dataKey="Списання"    stroke="#ef4444" strokeWidth={2.5} fill="url(#gradExpense)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Category sections */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <CategorySection title="Надходження по категоріях" total={totalIncome} categories={incomeByCategory} accent="#14b8a6" fmt={fmt} />
        <CategorySection title="Списання по категоріях"    total={totalExpense} categories={expenseByCategory} accent="#ef4444" fmt={fmt} />
      </div>

      {/* Transaction list */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="font-semibold text-gray-700 text-sm">Операції ({activeTxs.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Дата</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Сума</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Рахунок</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Контрагент</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Категорія</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Проект</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Коментар</th>
            </tr>
          </thead>
          <tbody>
            {activeTxs.map((t, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4 text-gray-600">{formatDate(t.date)}</td>
                <td className="py-3 px-4 font-medium">
                  <span className={t.type === 'income' ? 'text-teal-600' : 'text-red-500'}>
                    {t.type === 'income' ? '+' : '−'}{' '}
                    {t.amount.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} {t.currency}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-700">{t.account?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-600">{t.counterparty?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-600">{t.category?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-600">{t.project?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-500 text-xs">{t.comment ?? ''}</td>
              </tr>
            ))}
            {activeTxs.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Немає операцій</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function groupByCategory(txs: any[], toUAH: (amount: number, currency: string) => number) {
  const map: Record<string, number> = {}
  txs.forEach(t => {
    const name = t.category?.name ?? 'Без категорії'
    map[name] = (map[name] ?? 0) + toUAH(t.amount, t.currency)
  })
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
}

function CategorySection({
  title, total, categories, accent, fmt,
}: {
  title: string
  total: number
  categories: { name: string; value: number }[]
  accent: string
  fmt: (v: number) => string
}) {
  const maxVal = categories[0]?.value ?? 1

  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
        <span className="text-sm font-bold text-gray-800">{fmt(total)}</span>
      </div>
      <div className="flex gap-4 items-start">
        {/* Donut pie */}
        <div className="flex-shrink-0">
          <PieChart width={140} height={140}>
            <Pie
              data={categories.length > 0 ? categories.slice(0, 8) : [{ name: '', value: 1 }]}
              cx={65}
              cy={65}
              innerRadius={38}
              outerRadius={65}
              dataKey="value"
              paddingAngle={categories.length > 1 ? 2 : 0}
              strokeWidth={0}
            >
              {(categories.length > 0 ? categories.slice(0, 8) : [{ name: '', value: 1 }]).map((_, idx) => (
                <Cell
                  key={idx}
                  fill={categories.length > 0 ? PALETTE[idx % PALETTE.length] : '#e5e7eb'}
                />
              ))}
            </Pie>
            <Tooltip formatter={(v: any) => fmt(Number(v))} />
          </PieChart>
        </div>

        {/* Bar list */}
        <div className="flex-1 space-y-2.5 min-w-0">
          {categories.slice(0, 7).map((c, idx) => (
            <div key={c.name}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span className="truncate mr-2" style={{ color: PALETTE[idx % PALETTE.length] }}>
                  {c.name}
                </span>
                <span className="font-medium text-gray-700 whitespace-nowrap">{fmt(c.value)}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(c.value / maxVal) * 100}%`, backgroundColor: PALETTE[idx % PALETTE.length] }}
                />
              </div>
            </div>
          ))}
          {categories.length === 0 && <p className="text-xs text-gray-400 pt-4">Немає даних</p>}
        </div>
      </div>
    </div>
  )
}
