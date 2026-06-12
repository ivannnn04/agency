'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function FinancialMetricsPage() {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [metrics, setMetrics] = useState({ grossProfit: 0, marginalProfit: 0, margin: 0, ebitda: 0, income: 0, expense: 0 })
  const { toUAH, loading: ratesLoading } = useRates()

  useEffect(() => { if (!ratesLoading) fetchData() }, [month, year, ratesLoading])

  async function fetchData() {
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const end = month < 12
      ? `${year}-${String(month+1).padStart(2,'0')}-01`
      : `${year+1}-01-01`

    const { data } = await supabase
      .from('transactions')
      .select('type, amount, currency')
      .gte('date', start)
      .lt('date', end)
      .eq('is_planned', false)

    if (!data) return

    const income  = data.filter(t => t.type === 'income').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
    const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
    const grossProfit = income - expense
    const marginalProfit = grossProfit
    const margin = income > 0 ? (grossProfit / income) * 100 : 0
    const ebitda = grossProfit

    setMetrics({ grossProfit, marginalProfit, margin, ebitda, income, expense })
  }

  const monthName = new Date(year, month - 1, 1).toLocaleString('uk-UA', { month: 'long', year: 'numeric' })

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold text-gray-800">Фінансові показники</h1>
        <div className="ml-auto flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i+1} value={i+1}>{new Date(2024, i).toLocaleString('uk-UA', { month: 'long' })}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Індикатор</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">{monthName}</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Разом</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Валовий прибуток', value: metrics.grossProfit },
              { label: 'Маржинальний прибуток', value: metrics.marginalProfit },
              { label: 'Відсоток маржі', value: null, pct: metrics.margin },
              { label: 'EBITDA', value: metrics.ebitda },
            ].map(row => (
              <tr key={row.label} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3.5 px-4">
                  <span className="inline-block bg-gray-100 text-gray-700 px-3 py-1 rounded-lg text-sm font-medium">
                    {row.label}
                  </span>
                </td>
                <td className={`py-3.5 px-4 text-right font-medium ${row.value !== null && row.value >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                  {row.pct !== undefined
                    ? `${row.pct.toFixed(1)}%`
                    : `₴ ${row.value?.toLocaleString('uk-UA')}`
                  }
                </td>
                <td className={`py-3.5 px-4 text-right font-medium ${row.value !== null && row.value >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                  {row.pct !== undefined
                    ? `${row.pct.toFixed(1)}%`
                    : `₴ ${row.value?.toLocaleString('uk-UA')}`
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
