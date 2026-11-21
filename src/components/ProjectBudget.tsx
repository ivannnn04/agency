'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

// Project budget in the admin report: the starting contract, every later
// addition (a new stage sold, an approved client estimate) and their total.
// The total is what the rest of the app shows as the project budget.

interface BudgetItem { id: string; kind: 'base' | 'addition' | 'estimate'; title: string; amount: number; task_id: string | null; created_at: string | null }
interface Budget { items: BudgetItem[]; total: number; currency: string; ledger: boolean }

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const fmt = (n: number, cur: string) => `${n < 0 ? '−' : ''}${SYMBOL[cur] ?? ''}${Math.abs(n).toLocaleString('en-US')}`

export default function ProjectBudget({ projectId, fallbackAmount, fallbackCurrency, onChange }: {
  projectId: string
  fallbackAmount: number
  fallbackCurrency: string
  onChange: (total: number, currency: string) => void
}) {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/projects/budget?project=${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.items) setBudget(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId, nonce])

  // An estimate approved on the board changes the budget behind this panel
  useEffect(() => {
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener('gudrix:budget-changed', refresh)
    return () => window.removeEventListener('gudrix:budget-changed', refresh)
  }, [])

  async function call(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError('')
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return false }
    setBudget(d)
    onChange(d.total, d.currency)
    return true
  }

  const num = (v: string) => { const n = Number(v.replace(/\s/g, '').replace(',', '.')); return v.trim() && Number.isFinite(n) ? n : null }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const n = num(amount)
    if (!title.trim() || n === null || n === 0) { setError('Вкажи назву і суму'); return }
    if (await call('POST', '/api/projects/budget', { projectId, title, amount: n })) { setTitle(''); setAmount('') }
  }

  const total = budget?.total ?? fallbackAmount
  const currency = budget?.currency ?? fallbackCurrency
  const items = budget?.items ?? []
  const extra = items.filter(i => i.kind !== 'base')
  const input = 'text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400'

  return (
    <div className={`bg-gray-50 rounded-xl p-3 ${open ? 'col-span-2' : ''}`}>
      <button onClick={() => setOpen(v => !v)} className="w-full text-left group">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5 flex items-center justify-between">
          Бюджет (контракт)
          <span className="flex items-center gap-1 normal-case tracking-normal text-gray-500 group-hover:text-gray-900">
            <Pencil size={10} /> {open ? 'Згорнути' : 'Змінити'} <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </p>
        <p className="text-lg font-bold text-gray-900">{total ? fmt(total, currency) : '—'}</p>
        {!open && extra.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-0.5">старт {fmt(items.find(i => i.kind === 'base')?.amount ?? 0, currency)} + {extra.length} дод.</p>
        )}
      </button>

      {open && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          {!budget ? (
            <p className="text-xs text-gray-400">Завантаження…</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {items.map(item => (
                  <BudgetRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    disabled={busy}
                    onSave={patch => call('PATCH', '/api/projects/budget', { projectId, id: item.id, ...patch })}
                    onDelete={() => { if (confirm(`Прибрати «${item.title}» з бюджету?`)) call('DELETE', `/api/projects/budget?project=${projectId}&id=${item.id}`) }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-200">
                <span className="text-xs font-medium text-gray-600">Разом</span>
                <span className="text-sm font-bold text-gray-900">{fmt(total, currency)}</span>
              </div>

              {/* New stage sold, extra scope… */}
              <form onSubmit={add} className="mt-3 flex items-center gap-1.5">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Що додаємо: UI stage, новий скоуп…" className={`${input} flex-1 min-w-0`} />
                <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Сума" className={`${input} w-24`} />
                <button type="submit" disabled={busy} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-xs font-medium flex-shrink-0">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Додати
                </button>
              </form>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
                Додавай кожен новий етап чи допродаж окремим рядком — видно, з чого склався бюджет. Погоджена клієнтом оцінка з ціною додається сюди сама. Відʼємна сума зменшує бюджет.
              </p>

              <div className="flex items-center gap-2 mt-3">
                <span className="text-[10px] text-gray-500">Валюта</span>
                {(['USD', 'EUR', 'UAH'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => { if (c !== currency) call('PATCH', '/api/projects/budget', { projectId, currency: c }) }}
                    disabled={busy}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${c === currency ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 bg-white border border-gray-200'}`}
                  >
                    {SYMBOL[c]} {c}
                  </button>
                ))}
              </div>
              {!budget.ledger && (
                <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-2">
                  Початкову суму вже можна змінювати. Щоб додавати рядки, запусти міграцію supabase/project_budget_migration.sql.
                </p>
              )}
              {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BudgetRow({ item, currency, disabled, onSave, onDelete }: {
  item: BudgetItem
  currency: string
  disabled: boolean
  onSave: (patch: { amount?: number; title?: string }) => Promise<boolean>
  onDelete: () => void
}) {
  const [amount, setAmount] = useState(String(item.amount))
  const [title, setTitle] = useState(item.title)
  const base = item.kind === 'base'

  function commitAmount() {
    const n = Number(amount.replace(/\s/g, '').replace(',', '.'))
    if (!amount.trim() || !Number.isFinite(n)) { setAmount(String(item.amount)); return }
    if (n !== item.amount) onSave({ amount: n }).then(ok => { if (!ok) setAmount(String(item.amount)) })
  }
  function commitTitle() {
    const next = title.trim()
    if (!next) { setTitle(item.title); return }
    if (next !== item.title) onSave({ title: next })
  }
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur() }

  return (
    <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        {base ? (
          <p className="text-xs font-medium text-gray-800">{item.title}</p>
        ) : (
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={commitTitle} onKeyDown={blurOnEnter} disabled={disabled}
            className="w-full text-xs font-medium text-gray-800 bg-transparent focus:outline-none" />
        )}
        <p className="text-[10px] text-gray-400">
          {base ? 'з чого починали' : item.kind === 'estimate' ? 'погоджена оцінка задачі' : 'додано'}
          {item.created_at && !base ? ` · ${new Date(item.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
        </p>
      </div>
      <span className="text-xs text-gray-400">{SYMBOL[currency] ?? ''}</span>
      <input value={amount} onChange={e => setAmount(e.target.value)} onBlur={commitAmount} onKeyDown={blurOnEnter} inputMode="decimal" disabled={disabled}
        aria-label={`Сума: ${item.title}`}
        className="w-24 text-sm font-semibold text-gray-900 text-right border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
      {base ? <span className="w-[14px]" /> : (
        <button onClick={onDelete} disabled={disabled} className="text-gray-300 hover:text-red-500" title="Прибрати з бюджету"><Trash2 size={14} /></button>
      )}
    </div>
  )
}
