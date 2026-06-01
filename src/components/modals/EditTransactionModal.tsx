'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Account, Category, Project, Transaction, Currency, TransactionType } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  transaction: Transaction
  onClose: () => void
  onSuccess: () => void
}

export default function EditTransactionModal({ transaction: tx, onClose, onSuccess }: Props) {
  const [type, setType]             = useState<TransactionType>(tx.type)
  const [accounts, setAccounts]     = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [projects, setProjects]     = useState<Project[]>([])

  const [amount, setAmount]           = useState(String(tx.amount))
  const [currency, setCurrency]       = useState<Currency>(tx.currency as Currency)
  const [accountId, setAccountId]     = useState(tx.account_id)
  const [toAccountId, setToAccountId] = useState(tx.to_account_id ?? '')
  const [categoryId, setCategoryId]   = useState(tx.category_id ?? '')
  const [projectId, setProjectId]     = useState(tx.project_id ?? '')
  const [date, setDate]               = useState(tx.date.split('T')[0])
  const [comment, setComment]         = useState(tx.comment ?? '')
  const [isPlanned, setIsPlanned]     = useState(tx.is_planned)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('projects').select('*').neq('status', 'archived').order('name'),
    ]).then(([acc, cat, proj]) => {
      if (acc.data) setAccounts(acc.data)
      if (cat.data) setCategories(cat.data)
      if (proj.data) setProjects(proj.data)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !accountId) return
    setLoading(true)

    try {
      const newAmount = parseFloat(amount)

      // Update transaction record
      await supabase.from('transactions').update({
        type, amount: newAmount, currency,
        account_id: accountId,
        to_account_id: type === 'transfer' ? (toAccountId || null) : null,
        category_id: categoryId || null,
        project_id: projectId || null,
        date: new Date(date).toISOString(),
        comment: comment || null,
        is_planned: isPlanned,
      }).eq('id', tx.id)

      // Reverse old balance effect
      if (tx.type === 'income') {
        await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: -tx.amount })
      } else if (tx.type === 'expense') {
        await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: tx.amount })
      } else if (tx.type === 'transfer') {
        await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: tx.amount })
        if (tx.to_account_id) await supabase.rpc('update_account_balance', { p_account_id: tx.to_account_id, p_delta: -tx.amount })
      }

      // Apply new balance effect
      if (type === 'income') {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: newAmount })
      } else if (type === 'expense') {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: -newAmount })
      } else if (type === 'transfer' && toAccountId) {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: -newAmount })
        await supabase.rpc('update_account_balance', { p_account_id: toAccountId, p_delta: newAmount })
      }

      onSuccess()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const filteredCategories = categories.filter(c =>
    type === 'transfer' ? true : c.type === (type === 'income' ? 'income' : 'expense')
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex border-b border-gray-100">
          {(['income', 'expense', 'transfer'] as TransactionType[]).map(t => (
            <button key={t} onClick={() => setType(t)}
              className={cn('flex-1 py-3.5 text-sm font-medium transition-colors first:rounded-tl-2xl last:rounded-tr-2xl',
                type === t
                  ? t === 'income' ? 'bg-teal-500 text-white' : t === 'expense' ? 'bg-red-500 text-white' : 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:bg-gray-50')}>
              {t === 'income' ? '+ Дохід' : t === 'expense' ? '− Витрата' : '⇄ Переказ'}
            </button>
          ))}
          <button onClick={onClose} className="px-4 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div className="flex gap-3">
            <input type="number" placeholder="Сума" value={amount} onChange={e => setAmount(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-400" required />
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
              className="border border-gray-200 rounded-xl px-3 py-3 focus:outline-none bg-gray-50">
              <option value="UAH">UAH (₴)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>

          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none bg-white" required>
            <option value="">{type === 'expense' || type === 'transfer' ? 'З рахунку' : 'На рахунок'}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>

          {type === 'transfer' && (
            <select value={toAccountId} onChange={e => setToAccountId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none bg-white">
              <option value="">На рахунок</option>
              {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}

          {type !== 'transfer' && (
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none bg-white">
              <option value="">Категорія</option>
              {filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}

          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none bg-white">
            <option value="">Проект</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none" />

          <input type="text" placeholder="Коментар" value={comment} onChange={e => setComment(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none" />

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={isPlanned} onChange={e => setIsPlanned(e.target.checked)} className="w-4 h-4 accent-teal-500" />
            <span className="text-sm text-gray-600">Плановий платіж</span>
          </label>

          <button type="submit" disabled={loading}
            className={cn('w-full py-3.5 rounded-xl font-semibold text-white transition-opacity',
              loading ? 'opacity-50' : '',
              type === 'income' ? 'bg-gradient-to-r from-teal-400 to-teal-600'
                : type === 'expense' ? 'bg-gradient-to-r from-red-400 to-red-600'
                : 'bg-gradient-to-r from-gray-500 to-gray-700')}>
            {loading ? 'Збереження...' : 'Зберегти зміни'}
          </button>
        </form>
      </div>
    </div>
  )
}
