'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Transaction } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, Download, Filter } from 'lucide-react'

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transactions')
      .select(`
        *,
        account:accounts!account_id(id, name, currency, color),
        to_account:accounts!to_account_id(id, name, currency),
        category:categories(id, name, type),
        project:projects(id, name),
        counterparty:counterparties(id, name)
      `)
      .order('date', { ascending: false })

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo) query = query.lte('date', dateTo)

    const { data } = await query
    if (data) {
      const filtered = search
        ? data.filter(t =>
            t.counterparty?.name?.toLowerCase().includes(search.toLowerCase()) ||
            t.comment?.toLowerCase().includes(search.toLowerCase()) ||
            t.account?.name?.toLowerCase().includes(search.toLowerCase())
          )
        : data
      setTransactions(filtered)
    }
    setLoading(false)
  }, [search, dateFrom, dateTo])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  async function exportCSV() {
    const rows = [
      ['Дата', 'Тип', 'Сума', 'Валюта', 'Рахунок', 'Контрагент', 'Категорія', 'Проект', 'Коментар'],
      ...transactions.map(t => [
        formatDate(t.date),
        t.type === 'income' ? 'Дохід' : t.type === 'expense' ? 'Витрата' : 'Переказ',
        t.amount.toString(),
        t.currency,
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
    a.download = `платежі_${new Date().toLocaleDateString('uk-UA')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const planned = transactions.filter(t => t.is_planned)
  const actual = transactions.filter(t => !t.is_planned)

  return (
    <div className="p-6">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Пошук по рахунках, клієнтах, коментарях"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
          placeholder="Від"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
          placeholder="До"
        />
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors"
        >
          <Download size={16} />
        </button>
      </div>

      {/* Table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Дата</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Сума</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Рахунок / залишок</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Контрагент</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Категорія</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Проект</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Коментар</th>
            </tr>
          </thead>
          <tbody>
            {planned.length > 0 && (
              <>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <td colSpan={7} className="py-2 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Планові платежі • {planned.length}
                  </td>
                </tr>
                {planned.map(t => (
                  <TransactionRow key={t.id} transaction={t} />
                ))}
              </>
            )}
            {actual.map(t => (
              <TransactionRow key={t.id} transaction={t} />
            ))}
            {transactions.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  <p className="text-4xl mb-3">💸</p>
                  <p>Немає операцій</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TransactionRow({ transaction: t }: { transaction: Transaction }) {
  const isIncome = t.type === 'income'
  const isTransfer = t.type === 'transfer'

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      <td className="py-3 px-4 text-gray-600">{formatDate(t.date)}</td>
      <td className="py-3 px-4 font-medium">
        <span className={isIncome ? 'text-teal-600' : isTransfer ? 'text-gray-600' : 'text-red-500'}>
          {isIncome ? '+' : isTransfer ? '⇄' : '-'} {t.amount.toLocaleString('uk-UA')} {t.currency === 'UAH' ? '₴' : t.currency === 'USD' ? '$' : '€'}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.account?.color ?? '#14b8a6' }} />
          <span className="text-gray-700">{t.account?.name}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-gray-600">{t.counterparty?.name ?? '—'}</td>
      <td className="py-3 px-4">
        {t.category ? (
          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs">{t.category.name}</span>
        ) : (
          <span className="bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-gray-600">{t.project?.name ?? '—'}</td>
      <td className="py-3 px-4 text-gray-500 text-xs">{t.comment ?? ''}</td>
    </tr>
  )
}
