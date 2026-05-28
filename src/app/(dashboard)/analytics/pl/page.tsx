'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function PLPage() {
  const [data, setData] = useState<any[]>([])
  const [byCategory, setByCategory] = useState<any[]>([])
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => { fetchData() }, [year])

  async function fetchData() {
    const { data: txs } = await supabase
      .from('transactions')
      .select('type, amount, date, category:categories(name)')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('is_planned', false)

    if (!txs) return

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const mtxs = txs.filter(t => new Date(t.date).getMonth() + 1 === m)
      const income = mtxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = mtxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      return {
        name: new Date(year, i).toLocaleString('uk-UA', { month: 'short' }),
        Дохід: income,
        Витрата: expense,
        Прибуток: income - expense,
      }
    })
    setData(months)

    const map: Record<string, { income: number; expense: number }> = {}
    txs.forEach((t: any) => {
      const cat = t.category?.name ?? 'Без категорії'
      if (!map[cat]) map[cat] = { income: 0, expense: 0 }
      if (t.type === 'income') map[cat].income += t.amount
      else if (t.type === 'expense') map[cat].expense += t.amount
    })
    setByCategory(Object.entries(map).map(([name, v]) => ({ name, ...v, profit: v.income - v.expense })).sort((a, b) => b.profit - a.profit))
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Прибуток</h1>
          <p className="text-sm text-gray-400">Звіт про прибуток</p>
        </div>
        <div className="ml-auto">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-gray-100 rounded-xl p-4 mb-6">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
            <Tooltip formatter={(v) => `₴ ${Number(v).toLocaleString('uk-UA')}`} />
            <Legend />
            <Bar dataKey="Дохід" fill="#14b8a6" radius={[4,4,0,0]} />
            <Bar dataKey="Витрата" fill="#ef4444" radius={[4,4,0,0]} />
            <Bar dataKey="Прибуток" fill="#f59e0b" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Категорія</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Дохід, ₴</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Витрата, ₴</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Прибуток, ₴</th>
            </tr>
          </thead>
          <tbody>
            {byCategory.map(r => (
              <tr key={r.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4 text-gray-700">{r.name}</td>
                <td className="py-3 px-4 text-right text-teal-600">{r.income.toLocaleString('uk-UA')}</td>
                <td className="py-3 px-4 text-right text-red-500">{r.expense.toLocaleString('uk-UA')}</td>
                <td className={`py-3 px-4 text-right font-medium ${r.profit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>{r.profit.toLocaleString('uk-UA')}</td>
              </tr>
            ))}
            {byCategory.length === 0 && <tr><td colSpan={4} className="text-center py-12 text-gray-400">Немає даних</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
