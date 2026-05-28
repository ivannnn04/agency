'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Download } from 'lucide-react'
import Link from 'next/link'
import { Transaction } from '@/types'
import { formatDate } from '@/lib/utils'

export default function StatementPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccount, setSelectedAccount] = useState('all')
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    supabase.from('accounts').select('*').then(({ data }) => {
      if (data) setAccounts(data)
    })
  }, [])

  useEffect(() => { fetchData() }, [selectedAccount, year])

  async function fetchData() {
    let query = supabase
      .from('transactions')
      .select('*, account:accounts!account_id(id, name, color), category:categories(name), counterparty:counterparties(name), project:projects(name)')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: false })

    if (selectedAccount !== 'all') {
      query = query.eq('account_id', selectedAccount)
    }

    const { data } = await query
    if (data) setTransactions(data as Transaction[])
  }

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const transferIn = transactions.filter(t => t.type === 'transfer' && (selectedAccount === 'all' || t.to_account_id === selectedAccount)).reduce((s, t) => s + t.amount, 0)
  const transferOut = transactions.filter(t => t.type === 'transfer' && (selectedAccount === 'all' || t.account_id === selectedAccount)).reduce((s, t) => s + t.amount, 0)

  function exportCSV() {
    const rows = [
      ['Дата', 'Тип', 'Сума', 'Валюта', 'Рахунок', 'Контрагент', 'Категорія', 'Проект', 'Коментар'],
      ...transactions.map(t => [
        formatDate(t.date),
        t.type === 'income' ? 'Дохід' : t.type === 'expense' ? 'Витрата' : 'Переказ',
        t.amount.toString(),
        t.currency,
        (t as any).account?.name ?? '',
        (t as any).counterparty?.name ?? '',
        (t as any).category?.name ?? '',
        (t as any).project?.name ?? '',
        t.comment ?? '',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `виписка_${year}.csv`
    a.click()
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Виписка за рахунком</h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Надходжень', value: income, color: 'text-teal-600' },
          { label: 'Списань', value: expense, color: 'text-red-500' },
          { label: 'Переказ на рахунок', value: transferIn, color: 'text-blue-600' },
          { label: 'Переказ з рахунку', value: transferOut, color: 'text-gray-600' },
        ].map(item => (
          <div key={item.label} className="border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">{item.label}</p>
            <p className={`font-semibold ${item.color}`}>₴ {item.value.toLocaleString('uk-UA')}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          {[2023, 2024, 2025, 2026].map(y => (
            <option key={y} value={y}>{y} рік</option>
          ))}
        </select>
        <select
          value={selectedAccount}
          onChange={e => setSelectedAccount(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Всі рахунки</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
        >
          <Download size={16} /> CSV
        </button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
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
            {transactions.map(t => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4 text-gray-600">{formatDate(t.date)}</td>
                <td className="py-3 px-4 font-medium">
                  <span className={t.type === 'income' ? 'text-teal-600' : t.type === 'transfer' ? 'text-gray-600' : 'text-red-500'}>
                    {t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄' : '-'} {t.amount.toLocaleString('uk-UA')} ₴
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-700">{(t as any).account?.name}</td>
                <td className="py-3 px-4 text-gray-600">{(t as any).counterparty?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-600">{(t as any).category?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-600">{(t as any).project?.name ?? '—'}</td>
                <td className="py-3 px-4 text-gray-500 text-xs">{t.comment ?? ''}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Немає операцій</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
