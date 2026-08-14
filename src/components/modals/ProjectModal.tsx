'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Project } from '@/types'
import { X } from 'lucide-react'

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export default function ProjectModal({ project, onClose, onSuccess }: {
  project?: Project
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit = !!project

  const [name, setName]               = useState(project?.name ?? '')
  const [contractAmount, setContractAmount] = useState(project?.contract_amount ? String(project.contract_amount) : '')
  const [contractCurrency, setContractCurrency] = useState(project?.contract_currency ?? 'USD')
  const [receivedBefore, setReceivedBefore] = useState(project?.received_before_app ? String(project.received_before_app) : '')
  const [error, setError]             = useState('')
  const [saving, setSaving]           = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Введіть назву проекту'); return }
    setSaving(true)

    const palette = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#10b981']
    const payload = {
      name: name.trim(),
      contract_amount: contractAmount ? Number(contractAmount) : null,
      contract_currency: contractCurrency,
      received_before_app: receivedBefore ? Number(receivedBefore) : 0,
    }

    const { error: err } = isEdit
      ? await supabase.from('projects').update(payload).eq('id', project!.id)
      : await supabase.from('projects').insert({
          ...payload,
          status: 'active',
          color: palette[Math.floor(Math.random() * palette.length)],
        })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  const sym = CURRENCY_SYMBOL[contractCurrency]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Редагувати проект' : 'Новий проект'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Назва проекту *</label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              placeholder="Назва"
              value={name} onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Фінансові показники (необовʼязково)</p>
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Сума контракту</label>
                <input
                  type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="0.00"
                  value={contractAmount} onChange={e => setContractAmount(e.target.value)}
                />
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  value={contractCurrency} onChange={e => setContractCurrency(e.target.value)}
                >
                  <option>USD</option><option>EUR</option><option>UAH</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Вже отримано до старту програми
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sym}</span>
                <input
                  type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="0.00"
                  value={receivedBefore} onChange={e => setReceivedBefore(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Ця сума не зараховується на рахунок — враховується тільки для розрахунку маржинальності
              </p>
            </div>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : isEdit ? 'Зберегти' : 'Створити'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
