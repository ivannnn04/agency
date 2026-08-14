'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import {
  FolderOpen, BarChart2, TrendingUp, FileText, Clock, ChevronRight,
} from 'lucide-react'

export default function AnalyticsPage() {
  const { toUSD, fmtUSD, loading: ratesLoading } = useRates()
  const [remaining, setRemaining] = useState(0)
  const [contractsCount, setContractsCount] = useState(0)
  const [openInvoices, setOpenInvoices] = useState(0)
  const [openInvoicesCount, setOpenInvoicesCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    setLoading(true)

    const [{ data: projects }, { data: txs }, { data: invoices }] = await Promise.all([
      supabase.from('projects')
        .select('id, contract_amount, contract_currency, received_before_app')
        .neq('status', 'archived'),
      supabase.from('transactions')
        .select('type, amount, currency, project_id, is_planned')
        .eq('type', 'income').eq('is_planned', false),
      supabase.from('invoices')
        .select('amount, paid_amount, currency, status')
        .neq('status', 'paid'),
    ])

    // Received per project from actual income transactions
    const incomeByProject: Record<string, number> = {}
    for (const t of txs ?? []) {
      if (!t.project_id) continue
      incomeByProject[t.project_id] = (incomeByProject[t.project_id] ?? 0) + toUSD(t.amount, t.currency)
    }

    let rem = 0, cnt = 0
    for (const p of projects ?? []) {
      if (!p.contract_amount || p.contract_amount <= 0) continue
      const cur = p.contract_currency ?? 'USD'
      const contractUSD = toUSD(p.contract_amount, cur)
      const receivedUSD = toUSD(p.received_before_app ?? 0, cur) + (incomeByProject[p.id] ?? 0)
      const r = Math.max(0, contractUSD - receivedUSD)
      if (r > 0.5) { rem += r; cnt += 1 }
    }
    setRemaining(rem)
    setContractsCount(cnt)

    let inv = 0
    for (const i of invoices ?? []) {
      inv += toUSD(i.amount - (i.paid_amount ?? 0), i.currency)
    }
    setOpenInvoices(inv)
    setOpenInvoicesCount((invoices ?? []).length)

    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ratesLoading) fetchData() }, [ratesLoading])

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
        ? `${fmtUSD(openInvoices)} · ${openInvoicesCount} відкритих`
        : 'Немає відкритих рахунків',
    },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Аналітика</h1>

      {/* Total money to come in across all project contracts */}
      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-2 text-amber-500 mb-2">
          <Clock size={16} />
          <span className="text-xs font-medium uppercase tracking-wide">Має надійти з проєктів</span>
        </div>
        <p className="text-3xl font-bold text-amber-600">{loading ? '…' : fmtUSD(remaining)}</p>
        <p className="text-xs text-amber-500/70 mt-1">
          {loading ? '' : `за ${contractsCount} контрактами`}
        </p>
      </div>

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
