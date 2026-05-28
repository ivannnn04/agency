'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { ArrowLeft, Download } from 'lucide-react'
import Link from 'next/link'

export default function CashFlowPage() {
  const [data, setData] = useState<any[]>([])
  const [incomeByCategory, setIncomeByCategory] = useState<any[]>([])
  const [expenseByCategory, setExpenseByCategory] = useState<any[]>([])
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    fetchData()
  }, [year])

  async function fetchData() {
    const { data: txs } = await supabase
      .from('transactions')
      .select('*, category:categories(name, type)')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('is_planned', false)

    if (!txs) return

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      const monthTxs = txs.filter(t => new Date(t.date).getMonth() + 1 === month)
      const income = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      return {
        name: new Date(year, i, 1).toLocaleString('uk-UA', { month: 'short' }),
        Надходження: income,
        Списання: expense,
        Сальдо: income - expense,
      }
    })
    setData(months)

    const incomeTxs = txs.filter(t => t.type === 'income')
    const expenseTxs = txs.filter(t => t.type === 'expense')

    const incomeCat = groupByCategory(incomeTxs)
    const expenseCat = groupByCategory(expenseTxs)
    setIncomeByCategory(incomeCat)
    setExpenseByCategory(expenseCat)
  }

  function groupByCategory(txs: any[]) {
    const map: Record<string, number> = {}
    txs.forEach(t => {
      const name = t.category?.name ?? 'Без категорії'
      map[name] = (map[name] ?? 0) + t.amount
    })
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
  }

  const totalIncome = incomeByCategory.reduce((s, c) => s + c.amount, 0)
  const totalExpense = expenseByCategory.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Гроші</h1>
          <p className="text-sm text-gray-400">Звіт про рух грошових коштів (cash flow)</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {[2023, 2024, 2025, 2026].map(y => (
              <option key={y} value={y}>{y} рік</option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-gray-100 rounded-xl p-4 mb-6">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
            <Tooltip formatter={(v) => `₴ ${Number(v).toLocaleString('uk-UA')}`} />
            <Legend />
            <Line type="monotone" dataKey="Надходження" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Списання" stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Сальдо" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">
            Надходження ₴ {totalIncome.toLocaleString('uk-UA')}
          </h3>
          <div className="space-y-2">
            {incomeByCategory.map(c => (
              <div key={c.name} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-600">{c.name}</span>
                <span className="text-sm font-medium text-teal-600">₴ {c.amount.toLocaleString('uk-UA')}</span>
              </div>
            ))}
            {incomeByCategory.length === 0 && <p className="text-sm text-gray-400">Немає даних</p>}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">
            Списання ₴ {totalExpense.toLocaleString('uk-UA')}
          </h3>
          <div className="space-y-2">
            {expenseByCategory.map(c => (
              <div key={c.name} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-600">{c.name}</span>
                <span className="text-sm font-medium text-red-500">₴ {c.amount.toLocaleString('uk-UA')}</span>
              </div>
            ))}
            {expenseByCategory.length === 0 && <p className="text-sm text-gray-400">Немає даних</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
