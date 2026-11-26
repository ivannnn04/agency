'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useRates } from '@/lib/use-rates'
import AddTransactionModal from '@/components/modals/AddTransactionModal'
import { Transaction } from '@/types'
import {
  ExpectedRow, cleanComment, daysUntil, markReceived, payments, removeExpected, updateExpected, useExpectedIncome,
} from '@/lib/expectedIncome'

// Expected income: what should come in once projects are closed. Not tied to
// the next 30 days — every planned income, grouped by the month it is
// expected in, with totals per currency and in euro.

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const money = (n: number, c: string) =>
  (SYMBOL[c] ?? '') + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']

type Filter = 'all' | 'soon' | 'later' | 'overdue'

function byCurrency(rows: ExpectedRow[]) {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + Number(r.amount)
  return Object.entries(out).sort((a, b) => b[1] - a[1])
}

function when(days: number) {
  if (days < 0) return { text: `прострочено ${-days} дн`, cls: 'text-red-600 bg-red-50' }
  if (days === 0) return { text: 'сьогодні', cls: 'text-emerald-700 bg-emerald-50' }
  if (days <= 30) return { text: `через ${days} дн`, cls: 'text-emerald-700 bg-emerald-50' }
  return { text: `через ${days} дн`, cls: 'text-gray-500 bg-gray-100' }
}

export default function ExpectedIncomePage() {
  const { rows, error, reload } = useExpectedIncome()
  const { toEUR, rates } = useRates()
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [editingAmount, setEditingAmount] = useState<string | null>(null)
  const [modal, setModal] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })

  const list = useMemo(() => rows ?? [], [rows])
  const eur = (r: ExpectedRow) => toEUR(Number(r.amount), r.currency)
  const total = list.reduce((s, r) => s + eur(r), 0)
  const soon = list.filter(r => { const d = daysUntil(r.date); return d >= 0 && d <= 30 })
  const later = list.filter(r => daysUntil(r.date) > 30)
  const overdue = list.filter(r => daysUntil(r.date) < 0)

  const shown = filter === 'soon' ? soon : filter === 'later' ? later : filter === 'overdue' ? overdue : list
  const months = useMemo(() => {
    const m = new Map<string, ExpectedRow[]>()
    for (const r of shown) {
      const d = new Date(r.date)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      m.set(key, [...(m.get(key) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown])

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id); setActionError('')
    try { await fn(); reload() } catch (e) { setActionError((e as Error).message) }
    setBusy(null)
  }

  function received(r: ExpectedRow) {
    const account = r.account?.name ?? 'рахунок'
    if (!window.confirm(`Позначити як отримано ${money(Number(r.amount), r.currency)} від «${r.project?.name ?? cleanComment(r.comment)}»?\nСума піде на «${account}» сьогоднішньою датою й додасться до балансу.`)) return
    run(r.id, () => markReceived(r))
  }

  function remove(r: ExpectedRow) {
    if (!window.confirm(`Прибрати очікуване ${money(Number(r.amount), r.currency)} від «${r.project?.name ?? cleanComment(r.comment)}»?`)) return
    run(r.id, () => removeExpected(r.id))
  }

  const chip = (key: Filter, label: string, n: number) => (
    <button onClick={() => setFilter(key)}
      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'}`}>
      {label} · {n}
    </button>
  )

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><CalendarClock size={20} className="text-gray-400" /> Очікувані надходження</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Гроші, які мають зайти, коли проєкти закриються. Дата — орієнтовна, її можна змінити будь-коли.
            На баланс рахунку сума потрапляє лише після «Отримано».
          </p>
        </div>
        <button onClick={() => setModal({ open: true, tx: null })}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={14} /> Додати очікуване
        </button>
      </div>

      {rows === null ? (
        <p className="text-sm text-gray-400 py-10">Завантаження…</p>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="md:col-span-2 bg-gray-900 on-dark text-white rounded-2xl p-5">
              <p className="text-[11px] uppercase tracking-wide text-white/50">Усього очікується</p>
              <p className="text-3xl font-bold mt-1">≈ {money(Math.round(total), 'EUR')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-white/80">
                {byCurrency(list).map(([c, n]) => <span key={c}>{money(n, c)}</span>)}
              </div>
              <p className="text-[11px] text-white/40 mt-2">{payments(list.length)} · перерахунок у євро за курсом НБУ{rates.date ? ` на ${rates.date}` : ''}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">У найближчі 30 днів</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">≈ {money(Math.round(soon.reduce((s, r) => s + eur(r), 0)), 'EUR')}</p>
              <p className="text-xs text-gray-400 mt-1">{payments(soon.length)}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Пізніше</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">≈ {money(Math.round(later.reduce((s, r) => s + eur(r), 0)), 'EUR')}</p>
              <p className="text-xs text-gray-400 mt-1">{payments(later.length)}{overdue.length ? ` · прострочено: ${overdue.length}` : ''}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-4">
            {chip('all', 'Усі', list.length)}
            {chip('soon', '30 днів', soon.length)}
            {chip('later', 'Пізніше', later.length)}
            {overdue.length > 0 && chip('overdue', 'Прострочені', overdue.length)}
          </div>

          {(error || actionError) && <p className="text-sm text-red-600 mb-3">{error || actionError}</p>}

          {shown.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-sm text-gray-400">
              {list.length === 0 ? 'Очікуваних надходжень немає. Додай перше кнопкою вгорі.' : 'У цьому фільтрі нічого немає.'}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {months.map(([key, items]) => {
                const [y, m] = key.split('-').map(Number)
                return (
                  <section key={key} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 bg-gray-50 border-b border-gray-100">
                      <p className="text-sm font-semibold text-gray-900">{MONTHS[m]} {y}</p>
                      <p className="text-sm text-gray-600">
                        {byCurrency(items).map(([c, n]) => money(n, c)).join(' + ')}
                        <span className="text-gray-400"> · ≈ {money(Math.round(items.reduce((s, r) => s + eur(r), 0)), 'EUR')}</span>
                      </p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {items.map(r => {
                        const d = daysUntil(r.date)
                        const w = when(d)
                        const label = r.project?.name ?? cleanComment(r.comment) ?? '—'
                        const note = cleanComment(r.comment)
                        return (
                          <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_8rem_14.5rem_auto] items-center gap-x-4 gap-y-2 px-5 py-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.project?.color ?? '#d4d4d8' }} />
                                {label}
                                {!r.project && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">без проєкту</span>}
                              </p>
                              <p className="text-xs text-gray-400 truncate pl-4">
                                {note && note !== label ? `${note} · ` : ''}{r.account?.name ?? ''}
                              </p>
                            </div>
                            {/* Amount: click to change */}
                            <div className="text-right">
                              {editingAmount === r.id ? (
                                <input autoFocus type="number" min={0} step="any" defaultValue={r.amount}
                                  onBlur={e => { setEditingAmount(null); const v = Number(e.target.value); if (v > 0 && v !== Number(r.amount)) run(r.id, () => updateExpected(r.id, { amount: v })) }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingAmount(null) }}
                                  className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-900" />
                              ) : (
                                <button onClick={() => setEditingAmount(r.id)} className="text-base font-bold text-gray-900 tabular-nums hover:underline decoration-dotted" title="Змінити суму">
                                  {money(Number(r.amount), r.currency)}
                                </button>
                              )}
                              {r.currency !== 'EUR' && <p className="text-[11px] text-gray-400 tabular-nums">≈ {money(Math.round(eur(r)), 'EUR')}</p>}
                            </div>
                            {/* Expected date: change any time */}
                            <div className="flex items-center gap-2 col-span-2 md:col-span-1">
                              <input type="date" value={r.date.slice(0, 10)}
                                onChange={e => { if (e.target.value) run(r.id, () => updateExpected(r.id, { date: new Date(e.target.value + 'T12:00:00').toISOString() })) }}
                                className="text-xs text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                aria-label="Очікувана дата" />
                              <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${w.cls}`}>{w.text}</span>
                            </div>
                            <div className="flex items-center gap-1 justify-end col-span-2 md:col-span-1">
                              <button onClick={() => received(r)} disabled={busy === r.id}
                                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg px-2.5 py-1.5 text-xs font-medium">
                                <Check size={12} /> Отримано
                              </button>
                              <button onClick={() => setModal({ open: true, tx: r as unknown as Transaction })} title="Редагувати: проєкт, рахунок, коментар"
                                className="p-1.5 text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-100"><Pencil size={13} /></button>
                              <button onClick={() => remove(r)} disabled={busy === r.id} title="Прибрати"
                                className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-6 flex items-center gap-1"><X size={11} className="opacity-0" />
            «Отримано» робить платіж фактичним: він з’являється в «Платежах», аналітиці й балансі рахунку.
          </p>
        </>
      )}

      <AddTransactionModal
        open={modal.open}
        transaction={modal.tx}
        defaultType="income"
        defaultPlanned
        onClose={() => setModal({ open: false, tx: null })}
        onSuccess={() => { setModal({ open: false, tx: null }); reload(); window.dispatchEvent(new Event('gudrix:projects-changed')) }}
      />
    </div>
  )
}
