'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import AnalyticsHeadline from '@/components/analytics/AnalyticsHeadline'
import { FolderOpen, BarChart2, TrendingUp, FileText, ChevronRight } from 'lucide-react'

export default function AnalyticsPage() {
  const { toEUR, fmtEUR, loading: ratesLoading } = useRates()
  const [invoices, setInvoices] = useState<{ amount: number; paid_amount: number | null; currency: string }[] | null>(null)

  // Open invoices for the receivables card
  useEffect(() => {
    let alive = true
    supabase.from('invoices').select('amount, paid_amount, currency, status').neq('status', 'paid')
      .then(({ data }) => { if (alive) setInvoices(data ?? []) })
    return () => { alive = false }
  }, [])

  const loading = ratesLoading || invoices === null
  const openInvoices = (invoices ?? []).reduce((s, i) => s + toEUR(i.amount - (i.paid_amount ?? 0), i.currency), 0)
  const openInvoicesCount = (invoices ?? []).length

  const cards = [
    {
      href: '/analytics/projects',
      icon: FolderOpen,
      title: 'Проекти',
      description: 'Список усіх проєктів — клікни на проєкт і побачиш маржинальність, всі витрати списком і по місяцях',
      accent: 'group-hover:text-teal-500',
    },
    {
      href: '/analytics/pl',
      icon: BarChart2,
      title: 'P&L агенції',
      description: 'Повний звіт про прибутки і збитки по компанії',
      accent: 'group-hover:text-violet-500',
    },
    {
      href: '/analytics/cash-flow',
      icon: TrendingUp,
      title: 'Cash Flow',
      description: 'Рух грошових коштів по всіх рахунках',
      accent: 'group-hover:text-blue-500',
    },
    {
      href: '/receivables',
      icon: FileText,
      title: 'Дебіторка',
      description: 'Всі рахунки до отримання — додавання, редагування, часткові оплати',
      accent: 'group-hover:text-amber-500',
      stat: loading ? null : openInvoicesCount > 0
        ? `${fmtEUR(openInvoices)} · ${openInvoicesCount} відкритих`
        : 'Немає відкритих рахунків',
    },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Аналітика</h1>

      {/* Headline numbers with breakdowns, and a period for what came in */}
      <AnalyticsHeadline />

      {/* Section cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group border border-gray-200 rounded-2xl p-6 hover:border-gray-300 hover:shadow-sm transition-all flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <Icon size={26} className={`text-gray-400 transition-colors ${card.accent}`} />
                <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{card.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{card.description}</p>
              {card.stat && (
                <p className="text-sm font-semibold text-gray-800 mt-3 pt-3 border-t border-gray-100">{card.stat}</p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
