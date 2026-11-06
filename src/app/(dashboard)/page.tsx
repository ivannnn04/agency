'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Transaction } from '@/types'
import { formatDate } from '@/lib/utils'
import { adjustBalancesForTransaction } from '@/lib/transactionBalances'
import { Search, Download, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import AddTransactionModal from '@/components/modals/AddTransactionModal'

// One salary payout books an expense per project — in the list they collapse
// into a single accordion row. Batch = same day + account + "ЗП <name> — <month>".
function salaryBatchKey(t: Transaction): string | null {
  if (t.type !== 'expense' || !t.comment) return null
  const m = t.comment.match(/^(ЗП\s+.+?\s+—\s+.+?)\s*\(/)
  if (!m) return null
  return `${(t.date ?? '').slice(0, 10)}|${t.account?.id ?? ''}|${t.currency}|${m[1]}`
}

type ListItem =
  | { kind: 'tx'; t: Transaction }
  | { kind: 'group'; key: string; label: string; rows: Transaction[] }

function groupSalaryBatches(txs: Transaction[]): ListItem[] {
  const groups: Record<string, Transaction[]> = {}
  for (const t of txs) {
    const key = salaryBatchKey(t)
    if (key) (groups[key] ??= []).push(t)
  }
  const out: ListItem[] = []
  const emitted = new Set<string>()
  for (const t of txs) {
    const key = salaryBatchKey(t)
    if (key && groups[key].length > 1) {
      if (!emitted.has(key)) {
        emitted.add(key)
        out.push({ kind: 'group', key, label: key.split('|')[3], rows: groups[key] })
      }
      continue
    }
    out.push({ kind: 'tx', t })
  }
  return out
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [fetchError, setFetchError] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

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

    const { data, error } = await query
    if (error) {
      // A silent failure here looks like "no transactions" — surface it instead
      setFetchError(`Не вдалося завантажити платежі: ${error.message}`)
    } else if (data) {
      setFetchError('')
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

  async function deleteTransaction(t: Transaction) {
    if (!confirm('Видалити цю операцію? Баланс рахунку буде скориговано.')) return
    await adjustBalancesForTransaction(t, -1)
    await supabase.from('transactions').delete().eq('id', t.id)
    fetchTransactions()
  }

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
      <div className="border border-gray-100 rounded-xl overflow-x-auto">
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
              <th className="py-3 px-4" />
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
                {planned.map(t => (
                  <TransactionRow key={t.id} transaction={t} onEdit={() => setEditingTx(t)} onDelete={() => deleteTransaction(t)} />
                ))}
              </>
            )}
            {groupSalaryBatches(actual).map(item => {
              if (item.kind === 'tx') {
                return <TransactionRow key={item.t.id} transaction={item.t} onEdit={() => setEditingTx(item.t)} onDelete={() => deleteTransaction(item.t)} />
              }
              const open = openGroups.has(item.key)
              const total = item.rows.reduce((s, r) => s + r.amount, 0)
              const cur = item.rows[0].currency === 'UAH' ? '₴' : item.rows[0].currency === 'USD' ? '$' : '€'
              return (
                <GroupRows
                  key={item.key}
                  item={item}
                  open={open}
                  total={total}
                  cur={cur}
                  onToggle={() => setOpenGroups(prev => {
                    const n = new Set(prev)
                    if (n.has(item.key)) n.delete(item.key); else n.add(item.key)
                    return n
                  })}
                  onEdit={setEditingTx}
                  onDelete={deleteTransaction}
                />
              )
            })}
            {transactions.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-gray-400">
                  {fetchError ? (
                    <p className="text-sm text-red-500">{fetchError}</p>
                  ) : (
                    <>
                      <p className="text-4xl mb-3">💸</p>
                      <p>Немає операцій</p>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AddTransactionModal
        open={!!editingTx}
        transaction={editingTx}
        onClose={() => setEditingTx(null)}
        onSuccess={() => { setEditingTx(null); fetchTransactions() }}
      />
    </div>
  )
}

// Salary batch: one summary row, expandable to the per-project transactions
function GroupRows({ item, open, total, cur, onToggle, onEdit, onDelete }: {
  item: { key: string; label: string; rows: Transaction[] }
  open: boolean
  total: number
  cur: string
  onToggle: () => void
  onEdit: (t: Transaction) => void
  onDelete: (t: Transaction) => void
}) {
  const first = item.rows[0]
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
      >
        <td className="py-3 px-4 text-gray-600">{formatDate(first.date)}</td>
        <td className="py-3 px-4 font-medium">
          <span className="text-red-500">- {total.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} {cur}</span>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: first.account?.color ?? '#14b8a6' }} />
            <span className="text-gray-700">{first.account?.name}</span>
          </div>
        </td>
        <td className="py-3 px-4 text-gray-600">—</td>
        <td className="py-3 px-4">
          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs">{first.category?.name ?? 'Зарплата'}</span>
        </td>
        <td className="py-3 px-4 text-gray-600">{item.rows.length} проєкт{item.rows.length >= 5 ? 'ів' : item.rows.length > 1 ? 'и' : ''}</td>
        <td className="py-3 px-4 text-gray-600 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            {open ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />}
            {item.label}
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{item.rows.length}</span>
          </span>
        </td>
        <td className="py-3 px-4" />
      </tr>
      {open && item.rows.map(t => (
        <SalaryDetailRow key={t.id} transaction={t} onEdit={() => onEdit(t)} onDelete={() => onDelete(t)} />
      ))}
    </>
  )
}

// Expanded batch line: project + the per-project slice of the payout
function SalaryDetailRow({ transaction: t, onEdit, onDelete }: {
  transaction: Transaction
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <tr className="border-b border-gray-50 bg-gray-50/40 hover:bg-gray-50 transition-colors group">
      <td className="py-2 px-4" />
      <td className="py-2 px-4 text-xs font-medium text-red-400 whitespace-nowrap">
        - {t.amount.toLocaleString('uk-UA')} {t.currency === 'UAH' ? '₴' : t.currency === 'USD' ? '$' : '€'}
      </td>
      <td className="py-2 px-4" />
      <td className="py-2 px-4" />
      <td className="py-2 px-4" />
      <td className="py-2 px-4 text-xs text-gray-700">{t.project?.name ?? 'Без проєкту'}</td>
      <td className="py-2 px-4 text-gray-400 text-[11px]">{t.comment ?? ''}</td>
      <td className="py-2 px-4">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="text-gray-400 hover:text-gray-700 p-1 rounded" title="Редагувати">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 p-1 rounded" title="Видалити">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function TransactionRow({ transaction: t, onEdit, onDelete }: {
  transaction: Transaction
  onEdit: () => void
  onDelete: () => void
}) {
  const isIncome = t.type === 'income'
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
        {t.category ? (
          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs">{t.category.name}</span>
        ) : (
          <span className="bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-gray-600">{t.project?.name ?? '—'}</td>
      <td className="py-3 px-4 text-gray-500 text-xs">{t.comment ?? ''}</td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="text-gray-400 hover:text-gray-700 p-1 rounded" title="Редагувати">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 p-1 rounded" title="Видалити">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}
