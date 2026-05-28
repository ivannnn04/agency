'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface PlanFactRow {
  category_id: string
  category_name: string
  type: 'income' | 'expense'
  plan: number
  fact: number
}

export default function PlanFactPage() {
  const [rows, setRows] = useState<PlanFactRow[]>([])
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => { fetchData() }, [month, year])

  async function fetchData() {
    const [budgets, txs, cats] = await Promise.all([
      supabase.from('budgets').select('*, category:categories(id, name, type)').eq('year', year).eq('month', month),
      supabase.from('transactions').select('type, amount, category_id')
        .gte('date', `${year}-${String(month).padStart(2,'0')}-01`)
        .lt('date', `${year}-${String(month < 12 ? month + 1 : 1).padStart(2,'0')}-01`)
        .eq('is_planned', false),
      supabase.from('categories').select('*'),
    ])

    const factMap: Record<string, number> = {}
    txs.data?.forEach(t => {
      if (t.category_id) {
        factMap[t.category_id] = (factMap[t.category_id] ?? 0) + t.amount
      }
    })

    const result: PlanFactRow[] = (budgets.data ?? []).map((b: any) => ({
      category_id: b.category_id,
      category_name: b.category?.name ?? 'Невідома',
      type: b.type,
      plan: b.amount,
      fact: factMap[b.category_id] ?? 0,
    }))

    setRows(result)
  }

  async function updatePlan(categoryId: string, type: 'income' | 'expense', value: number) {
    await supabase.from('budgets').upsert({
      category_id: categoryId,
      year,
      month,
      amount: value,
      type,
    }, { onConflict: 'category_id,year,month' })
  }

  const incomeRows = rows.filter(r => r.type === 'income')
  const expenseRows = rows.filter(r => r.type === 'expense')

  const totalIncomePlan = incomeRows.reduce((s, r) => s + r.plan, 0)
  const totalIncomeFact = incomeRows.reduce((s, r) => s + r.fact, 0)
  const totalExpensePlan = expenseRows.reduce((s, r) => s + r.plan, 0)
  const totalExpenseFact = expenseRows.reduce((s, r) => s + r.fact, 0)

  const monthName = new Date(year, month - 1, 1).toLocaleString('uk-UA', { month: 'long', year: 'numeric' })

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">План/Факт</h1>
        <div className="ml-auto flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i+1} value={i+1}>
                {new Date(2024, i, 1).toLocaleString('uk-UA', { month: 'long' })}
              </option>
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
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Категорія</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">План</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Факт</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Відхилення</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Дохід" plan={totalIncomePlan} fact={totalIncomeFact} />
            {incomeRows.map(r => <PlanFactRow key={r.category_id} row={r} />)}

            <SectionHeader label="Витрата" plan={totalExpensePlan} fact={totalExpenseFact} />
            {expenseRows.map(r => <PlanFactRow key={r.category_id} row={r} />)}

            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-400">
                  Немає бюджетів. Додайте категорії та встановіть планові суми у налаштуваннях.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SectionHeader({ label, plan, fact }: { label: string; plan: number; fact: number }) {
  const dev = fact - plan
  const pct = plan > 0 ? Math.round((dev / plan) * 100) : 0
  return (
    <tr className="bg-gray-50/80 border-b border-gray-100">
      <td className="py-2.5 px-4 font-semibold text-gray-800">{label}</td>
      <td className="py-2.5 px-4 text-right font-medium">{plan.toLocaleString('uk-UA')}</td>
      <td className="py-2.5 px-4 text-right font-medium">{fact.toLocaleString('uk-UA')}</td>
      <td className={`py-2.5 px-4 text-right font-medium ${dev >= 0 ? 'text-teal-600' : 'text-red-500'}`}>
        {dev.toLocaleString('uk-UA')}
      </td>
      <td className={`py-2.5 px-4 text-right ${pct >= 0 ? 'text-teal-600' : 'text-red-500'}`}>({pct}%)</td>
    </tr>
  )
}

function PlanFactRow({ row }: { row: PlanFactRow }) {
  const dev = row.fact - row.plan
  const pct = row.plan > 0 ? Math.round((dev / row.plan) * 100) : 0
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50">
      <td className="py-2.5 px-4 pl-8 text-gray-600">— {row.category_name}</td>
      <td className="py-2.5 px-4 text-right text-gray-600">{row.plan.toLocaleString('uk-UA')}</td>
      <td className="py-2.5 px-4 text-right text-gray-600">{row.fact.toLocaleString('uk-UA')}</td>
      <td className={`py-2.5 px-4 text-right ${dev >= 0 ? 'text-teal-600' : 'text-red-500'}`}>{dev.toLocaleString('uk-UA')}</td>
      <td className={`py-2.5 px-4 text-right ${pct >= 0 ? 'text-teal-600' : 'text-red-500'}`}>({pct}%)</td>
    </tr>
  )
}
