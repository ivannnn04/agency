'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { PMTask } from '@/types/pm'

// The estimate of a task, shown the same way to everyone who opens it —
// admin and team alike: hours, and for client-approved work the hourly rate
// and the total the client agreed to.

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const STATUS: Record<string, { text: string; cls: string }> = {
  approved: { text: 'Погоджено клієнтом', cls: 'text-green-700 bg-green-100' },
  sent: { text: 'Чекаємо на клієнта', cls: 'text-blue-700 bg-blue-50' },
  changes: { text: 'Клієнт просить змінити', cls: 'text-red-600 bg-red-50' },
  needed: { text: 'Потрібна оцінка', cls: 'text-amber-700 bg-amber-50' },
}

// Small label for board cards: "8 год · $360"
export function TaskEstimateChip({ task, currency }: { task: PMTask; currency?: string | null }) {
  if (task.estimate_hours == null && !task.estimate_cost) return null
  const sym = SYMBOL[currency ?? 'USD'] ?? ''
  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 ${task.estimate_status === 'approved' ? 'text-green-700 bg-green-100' : 'text-gray-600 bg-gray-100'}`}
      title={task.estimate_status === 'approved' ? 'Оцінка, погоджена клієнтом' : 'Оцінка задачі'}
    >
      <Clock size={10} />
      {task.estimate_hours != null ? `${num(task.estimate_hours)} год` : ''}
      {task.estimate_cost ? `${task.estimate_hours != null ? ' · ' : ''}${sym}${num(task.estimate_cost)}` : ''}
    </span>
  )
}

// The block at the top of a task panel
export function TaskEstimateBlock({ task, currency, onUpdate }: {
  task: PMTask
  currency?: string | null
  onUpdate: (patch: Partial<PMTask>) => void
}) {
  const sym = SYMBOL[currency ?? 'USD'] ?? ''
  const status = task.estimate_status ? STATUS[task.estimate_status] : null
  // What the client agreed to is fixed; anything else can still be re-estimated here
  const locked = task.estimate_status === 'approved' || task.estimate_status === 'sent'
  const [hours, setHours] = useState(task.estimate_hours != null ? String(task.estimate_hours) : '')

  function save() {
    const v = hours.trim() === '' ? null : Number(hours.replace(',', '.'))
    if (v !== null && !Number.isFinite(v)) { setHours(task.estimate_hours != null ? String(task.estimate_hours) : ''); return }
    if (v !== (task.estimate_hours ?? null)) onUpdate({ estimate_hours: v })
  }

  const rate = Number(task.estimate_rate ?? 0), cost = Number(task.estimate_cost ?? 0)
  const decided = task.estimate_status === 'approved' && task.estimate_decided_at
    ? ` · ${new Date(task.estimate_decided_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`
    : ''

  return (
    <div className={`rounded-xl border px-4 py-3 ${task.estimate_status === 'approved' ? 'border-green-200 bg-green-50/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Estimate</p>
        {status ? (
          <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${status.cls}`}>{status.text}{decided}</span>
        ) : task.estimate_hours == null ? (
          <span className="text-[10px] font-medium rounded px-1.5 py-0.5 text-amber-700 bg-amber-50">Без оцінки</span>
        ) : task.estimate_by ? (
          <span className="text-[10px] text-gray-400">оцінив: {task.estimate_by}</span>
        ) : null}
      </div>

      <div className="flex items-end gap-x-6 gap-y-2 flex-wrap mt-2">
        <div>
          <p className="text-[10px] text-gray-400">Час</p>
          {locked ? (
            <p className="text-2xl font-bold text-gray-900 leading-tight">{task.estimate_hours != null ? `${num(task.estimate_hours)} год` : '—'}</p>
          ) : (
            <p className="flex items-baseline gap-1.5">
              <input
                value={hours}
                onChange={e => setHours(e.target.value)}
                onBlur={save}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                inputMode="decimal"
                placeholder="—"
                aria-label="Оцінка, годин"
                className="w-16 text-2xl font-bold text-gray-900 leading-tight bg-transparent border-b border-dashed border-gray-300 focus:border-gray-900 focus:outline-none"
              />
              <span className="text-sm text-gray-500">год</span>
            </p>
          )}
        </div>
        {rate > 0 && (
          <div>
            <p className="text-[10px] text-gray-400">Рейт</p>
            <p className="text-2xl font-bold text-gray-900 leading-tight">{sym}{num(rate)}<span className="text-sm font-normal text-gray-500">/год</span></p>
          </div>
        )}
        {cost > 0 && (
          <div>
            <p className="text-[10px] text-gray-400">Разом</p>
            <p className="text-2xl font-bold text-gray-900 leading-tight">{sym}{num(cost)}</p>
          </div>
        )}
      </div>
      {task.estimate_note && <p className="text-xs text-gray-500 mt-2 whitespace-pre-line">{task.estimate_note}</p>}
      {task.estimate_status === 'changes' && task.estimate_client_comment && (
        <p className="text-xs text-red-600 mt-2">Коментар клієнта: {task.estimate_client_comment}</p>
      )}
    </div>
  )
}
