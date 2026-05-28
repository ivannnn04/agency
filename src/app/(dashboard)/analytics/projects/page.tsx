'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface ProjectStats {
  id: string
  name: string
  income: number
  expense: number
  profit: number
  ratio: number
  margin: number
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectStats[]>([])
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => { fetchData() }, [year])

  async function fetchData() {
    const { data: projs } = await supabase.from('projects').select('*')
    const { data: txs } = await supabase
      .from('transactions')
      .select('type, amount, project_id')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('is_planned', false)

    if (!projs || !txs) return

    const stats = projs.map(p => {
      const ptxs = txs.filter(t => t.project_id === p.id)
      const income = ptxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = ptxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      const profit = income - expense
      const ratio = expense > 0 ? Math.round((income / expense) * 100) : 0
      const margin = income > 0 ? Math.round((profit / income) * 100) : 0
      return { id: p.id, name: p.name, income, expense, profit, ratio, margin }
    })

    setProjects(stats.sort((a, b) => b.profit - a.profit))
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Проекти</h1>
        <div className="ml-auto">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Назва</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Доходи, ₴</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Витрати, ₴</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Прибуток, ₴</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Дохід/Витрати, %</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Рентабельність, %</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4 font-medium text-gray-800">{p.name}</td>
                <td className="py-3 px-4 text-right text-teal-600">{p.income.toLocaleString('uk-UA')}</td>
                <td className="py-3 px-4 text-right text-red-500">{p.expense.toLocaleString('uk-UA')}</td>
                <td className={`py-3 px-4 text-right font-medium ${p.profit >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
                  {p.profit.toLocaleString('uk-UA')}
                </td>
                <td className="py-3 px-4 text-right text-gray-600">{p.ratio}</td>
                <td className="py-3 px-4 text-right text-gray-600">{p.margin}</td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Немає проектів</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
