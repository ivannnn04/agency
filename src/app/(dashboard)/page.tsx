'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Transaction } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useRates } from '@/lib/use-rates'
import { Search, Download, Edit2, Trash2 } from 'lucide-react'
import EditTransactionModal from '@/components/modals/EditTransactionModal'

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [editTx, setEditTx]             = useState<Transaction | null>(null)
  const [deleteTx, setDeleteTx]         = useState<Transaction | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const { rates } = useRates()

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transactions')
      .select(`*, account:accounts!account_id(id,name,currency,color),
        to_account:accounts!to_account_id(id,name,currency),
        category:categories(id,name,type),
        project:projects(id,name),
        counterparty:counterparties(id,name)`)
      .order('date', { ascending: false })

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo)   query = query.lte('date', dateTo)

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

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  async function exportCSV() {
    const rows = [
      ['Дата','Тип','Сума','Валюта','Рахунок','Контрагент','Категорія','Проект','Коментар'],
      ...transactions.map(t => [
        formatDate(t.date),
        t.type === 'income' ? 'Дохід' : t.type === 'expense' ? 'Витрата' : 'Переказ',
        t.amount.toString(), t.currency,
        t.account?.name ?? '', t.counterparty?.name ?? '',
        t.category?.name ?? '', t.project?.name ?? '', t.comment ?? '',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `платежі_${new Date().toLocaleDateString('uk-UA')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  async function confirmDelete() {
    if (!deleteTx) return
    setDeleting(true)
    const t = deleteTx
    // Compute how much this transaction actually affected the account balance
    // (transactions may be stored in original currency or already converted)
    const accCurrency = t.account?.currency ?? t.currency
    let delta = t.amount
    if (t.currency !== accCurrency) {
      const r = accCurrency === 'UAH'
        ? (t.currency === 'USD' ? rates.USD : t.currency === 'EUR' ? rates.EUR : 1)
        : accCurrency === 'USD' && t.currency === 'UAH'
          ? (rates.USD > 0 ? 1 / rates.USD : 1)
          : 1
      delta = Math.round(t.amount * r * 100) / 100
    }
    // Reverse balance effect
    if (t.type === 'income') {
      await supabase.rpc('update_account_balance', { p_account_id: t.account_id, p_delta: -delta })
    } else if (t.type === 'expense') {
      await supabase.rpc('update_account_balance', { p_account_id: t.account_id, p_delta: delta })
    } else if (t.type === 'transfer') {
      await supabase.rpc('update_account_balance', { p_account_id: t.account_id, p_delta: t.amount })
      if (t.to_account_id) await supabase.rpc('update_account_balance', { p_account_id: t.to_account_id, p_delta: -t.amount })
    }
    await supabase.from('transactions').delete().eq('id', t.id)
    setDeleting(false)
    setDeleteTx(null)
    fetchTransactions()
  }

  const planned = transactions.filter(t => t.is_planned)
  const actual  = transactions.filter(t => !t.is_planned)

  return (
    <div className="p-6">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Пошук по рахунках, клієнтах, коментарях"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
        <button onClick={exportCSV}
          className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors">
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
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Рахунок</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Контрагент</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Категорія</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Проект</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Коментар</th>
              <th className="w-16 py-3 px-2" />
            </tr>
          </thead>
          <tbody>
            {planned.length > 0 && (
              <>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <td colSpan={8} className="py-2 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Планові платежі • {planned.length}
                  </td>
                </tr>
                {planned.map(t => <TransactionRow key={t.id} transaction={t} onEdit={() => setEditTx(t)} onDelete={() => setDeleteTx(t)} />)}
              </>
            )}
            {actual.map(t => <TransactionRow key={t.id} transaction={t} onEdit={() => setEditTx(t)} onDelete={() => setDeleteTx(t)} />)}
            {transactions.length === 0 && !loading && (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">💸</p><p>Немає операцій</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editTx && (
        <EditTransactionModal
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSuccess={() => { setEditTx(null); fetchTransactions() }}
        />
      )}

      {deleteTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-5">
            <div>
              <p className="font-semibold text-gray-900 text-base">Видалити транзакцію?</p>
              <p className="text-sm text-gray-500 mt-1">
                {deleteTx.type === 'income' ? '+' : deleteTx.type === 'transfer' ? '⇄' : '−'}{' '}
                {deleteTx.amount.toLocaleString('uk-UA')} {deleteTx.currency} · {formatDate(deleteTx.date)}
              </p>
              <p className="text-xs text-gray-400 mt-2">Баланс рахунку буде скориговано автоматично. Цю дію не можна скасувати.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTx(null)} disabled={deleting}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Скасувати
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                {deleting ? 'Видалення...' : 'Видалити'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TransactionRow({ transaction: t, onEdit, onDelete }: { transaction: Transaction; onEdit: () => void; onDelete: () => void }) {
  const isIncome   = t.type === 'income'
  const isTransfer = t.type === 'transfer'

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
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
        {t.category
          ? <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs">{t.category.name}</span>
          : <span className="bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full text-xs">—</span>}
      </td>
      <td className="py-3 px-4 text-gray-600">{t.project?.name ?? '—'}</td>
      <td className="py-3 px-4 text-gray-500 text-xs max-w-xs truncate">{t.comment ?? ''}</td>
      <td className="py-3 px-2">
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all">
          <button onClick={onEdit}
            className="text-gray-400 hover:text-gray-700 p-1 rounded transition-colors"
            title="Редагувати">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete}
            className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors"
            title="Видалити">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}
