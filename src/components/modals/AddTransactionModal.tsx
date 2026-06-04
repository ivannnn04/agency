'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Account, Category, Project, Counterparty, Currency, TransactionType } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  defaultType?: TransactionType
  onClose: () => void
  onSuccess: () => void
}

export default function AddTransactionModal({ open, defaultType = 'income', onClose, onSuccess }: Props) {
  const [type, setType] = useState<TransactionType>(defaultType)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [toAmount, setToAmount] = useState('')
  const [toCurrency, setToCurrency] = useState<Currency>('UAH')
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [counterpartyId, setCounterpartyId] = useState('')
  const [newCounterparty, setNewCounterparty] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [comment, setComment] = useState('')
  const [isPlanned, setIsPlanned] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setType(defaultType)
      fetchData()
    }
  }, [open, defaultType])

  async function fetchData() {
    const [acc, cat, proj, cpart] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('projects').select('*').eq('status', 'active').order('name'),
      supabase.from('counterparties').select('*').order('name'),
    ])
    if (acc.data) setAccounts(acc.data)
    if (cat.data) setCategories(cat.data)
    if (proj.data) setProjects(proj.data)
    if (cpart.data) setCounterparties(cpart.data)
    if (acc.data?.[0]) setAccountId(acc.data[0].id)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !accountId) return
    setLoading(true)

    try {
      let finalCounterpartyId = counterpartyId || null

      if (newCounterparty.trim()) {
        const { data } = await supabase
          .from('counterparties')
          .insert({ name: newCounterparty.trim() })
          .select()
          .single()
        if (data) finalCounterpartyId = data.id
      }

      const txAmount = parseFloat(amount)
      const toTxAmount = type === 'transfer' ? parseFloat(toAmount || amount) : txAmount
      const payload: Record<string, unknown> = {
        type,
        amount: txAmount,
        currency,
        account_id: accountId,
        category_id: categoryId || null,
        project_id: projectId || null,
        counterparty_id: finalCounterpartyId,
        date: new Date(date).toISOString(),
        comment: comment || null,
        is_planned: isPlanned,
      }

      if (type === 'transfer') {
        payload.to_account_id = toAccountId || null
        payload.to_amount = toTxAmount
        payload.to_currency = toCurrency
      }

      await supabase.from('transactions').insert(payload)

      // Update account balance
      if (type === 'income') {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: txAmount })
      } else if (type === 'expense') {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: -txAmount })
      } else if (type === 'transfer' && toAccountId) {
        await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: -txAmount })
        await supabase.rpc('update_account_balance', { p_account_id: toAccountId, p_delta: toTxAmount })
      }

      onSuccess()
      onClose()
      resetForm()
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setAmount('')
    setCurrency('UAH')
    setToAmount('')
    setToCurrency('UAH')
    setCategoryId('')
    setProjectId('')
    setCounterpartyId('')
    setNewCounterparty('')
    setDate(new Date().toISOString().split('T')[0])
    setComment('')
    setIsPlanned(false)
  }

  if (!open) return null

  const filteredCategories = categories.filter(c =>
    type === 'transfer' ? true : c.type === (type === 'income' ? 'income' : 'expense')
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        {/* Type tabs */}
        <div className="flex border-b border-gray-100">
          {(['income', 'expense', 'transfer'] as TransactionType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                'flex-1 py-3.5 text-sm font-medium transition-colors first:rounded-tl-2xl last:rounded-tr-2xl',
                type === t
                  ? t === 'income'
                    ? 'bg-teal-500 text-white'
                    : t === 'expense'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              )}
            >
              {t === 'income' ? '+ Дохід' : t === 'expense' ? '− Витрата' : '⇄ Переказ'}
            </button>
          ))}
          <button onClick={onClose} className="px-4 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Amount + Currency */}
          {type === 'transfer' ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-3 items-center">
                <span className="text-xs text-gray-500 w-20 shrink-0">Відправляю</span>
                <input type="number" placeholder="Сума" value={amount}
                  onChange={e => setAmount(e.target.value)} required
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400" />
                <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
                  className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50">
                  <option value="UAH">UAH (₴)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div className="flex gap-3 items-center">
                <span className="text-xs text-gray-500 w-20 shrink-0">Отримую</span>
                <input type="number" placeholder="Сума" value={toAmount}
                  onChange={e => setToAmount(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400" />
                <select value={toCurrency} onChange={e => setToCurrency(e.target.value as Currency)}
                  className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50">
                  <option value="UAH">UAH (₴)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <input type="number" placeholder="Сума" value={amount}
                onChange={e => setAmount(e.target.value)} required
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
                className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50">
                <option value="UAH">UAH (₴)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          )}

          {/* Account */}
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            required
          >
            <option value="">{type === 'expense' || type === 'transfer' ? 'З рахунку' : 'На рахунок'}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>

          {/* To account (transfer) */}
          {type === 'transfer' && (
            <select
              value={toAccountId}
              onChange={e => setToAccountId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            >
              <option value="">На рахунок</option>
              {accounts.filter(a => a.id !== accountId).map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          )}

          {/* Category */}
          {type !== 'transfer' && (
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            >
              <option value="">Категорія</option>
              {filteredCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Project */}
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
          >
            <option value="">Проект</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Counterparty (expense) */}
          {type === 'expense' && (
            <div className="flex gap-2">
              <select
                value={counterpartyId}
                onChange={e => { setCounterpartyId(e.target.value); setNewCounterparty('') }}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
              >
                <option value="">Кому (контрагент)</option>
                {counterparties.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Новий"
                value={newCounterparty}
                onChange={e => { setNewCounterparty(e.target.value); setCounterpartyId('') }}
                className="w-28 border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 text-sm"
              />
            </div>
          )}

          {/* Date */}
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
          />

          {/* Comment */}
          <input
            type="text"
            placeholder="Коментар (опціонально)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
          />

          {/* Planned toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isPlanned}
              onChange={e => setIsPlanned(e.target.checked)}
              className="w-4 h-4 accent-teal-500"
            />
            <span className="text-sm text-gray-600">Плановий платіж</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full py-3.5 rounded-xl font-semibold text-white transition-opacity',
              loading ? 'opacity-50' : '',
              type === 'income'
                ? 'bg-gradient-to-r from-teal-400 to-teal-600'
                : type === 'expense'
                ? 'bg-gradient-to-r from-red-400 to-red-600'
                : 'bg-gradient-to-r from-gray-500 to-gray-700'
            )}
          >
            {loading ? 'Збереження...' : 'Зберегти'}
          </button>
        </form>
      </div>
    </div>
  )
}
