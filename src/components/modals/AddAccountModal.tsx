'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AccountType, Currency } from '@/types'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const COLORS = ['#14b8a6', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981', '#f97316']

export default function AddAccountModal({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('bank')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [balance, setBalance] = useState('')
  const [color, setColor] = useState('#14b8a6')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('accounts').insert({
      name: name.trim(),
      type,
      currency,
      balance: parseFloat(balance) || 0,
      color,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    setType('bank')
    setCurrency('UAH')
    setBalance('')
    setColor('#14b8a6')
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Новий рахунок</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Назва</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="Наприклад: Монобанк"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Тип рахунку</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as AccountType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="bank">🏦 Банк</option>
                <option value="cash">💵 Готівка</option>
                <option value="card">💳 Картка</option>
                <option value="safe">🔒 Сейф</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Валюта</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as Currency)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="UAH">₴ UAH</option>
                <option value="USD">$ USD</option>
                <option value="EUR">€ EUR</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Початковий баланс</label>
            <input
              type="number"
              value={balance}
              onChange={e => setBalance(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">Колір</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm hover:bg-gray-50"
          >
            Скасувати
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="flex-1 bg-gray-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  )
}
