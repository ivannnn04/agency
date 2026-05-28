'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Account, Currency } from '@/types'

interface Props {
  open: boolean
  title: string
  totalAmount: number
  type: 'income' | 'expense'
  onClose: () => void
  onSuccess: () => void
}

export default function SettleModal({ open, title, totalAmount, type, onClose, onSuccess }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(totalAmount.toString())
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount(totalAmount.toString())
      supabase.from('accounts').select('*').then(({ data }) => {
        if (data) {
          setAccounts(data)
          if (data[0]) setAccountId(data[0].id)
        }
      })
    }
  }, [open, totalAmount])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) return
    setLoading(true)
    try {
      const txAmount = parseFloat(amount)
      await supabase.from('transactions').insert({
        type,
        amount: txAmount,
        currency,
        account_id: accountId,
        date: new Date(date).toISOString(),
        comment: `Погашення ${type === 'income' ? 'дебіторки' : 'кредиторки'}`,
        is_planned: false,
      })
      await supabase.rpc('update_account_balance', {
        p_account_id: accountId,
        p_delta: type === 'income' ? txAmount : -txAmount,
      })
      onSuccess()
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-xl font-bold text-gray-800 leading-tight">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4">
            <X size={20} />
          </button>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          Повна сума заборгованості — {totalAmount.toLocaleString('uk-UA')} ₴.
          Якщо сума погашення неповна, початковий платіж зменшиться на вказану тут суму.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
            required
          >
            <option value="">З рахунку</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="flex gap-3">
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
              required
            />
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value as Currency)}
              className="border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
            >
              <option value="UAH">UAH (₴)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-orange-400 to-orange-500 hover:opacity-90 transition-opacity"
          >
            {loading ? 'Збереження...' : 'Створити платіж'}
          </button>
        </form>
      </div>
    </div>
  )
}
