'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft, ChevronRight, FileText, Loader2, RotateCcw } from 'lucide-react'

// "To be invoiced", month by month. Every task that reached a project's
// "To be invoiced" column in the chosen month, laid out per project as an
// invoice draft: lines, hours, amounts, total. Clients never see this —
// on their side those tasks are simply Done.

interface Line {
  id: string
  title: string
  ready_at: string
  tracked_hours: number
  estimate_hours: number | null
  amount: number | null
  source: 'manual' | 'estimate' | 'hours' | null
  invoiced_at: string | null
}
interface ProjectBlock { id: string; name: string; color: string | null; currency: string; rate: number | null; clients: string[]; lines: Line[] }
interface Report {
  month: string
  current: string
  months: { month: string; open: number; invoiced: number }[]
  projects: ProjectBlock[]
  migrated: boolean
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const money = (n: number, cur: string) => `${SYMBOL[cur] ?? ''}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const monthLabel = (m: string) => {
  const s = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const shift = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + by, 15))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const SOURCE: Record<string, string> = { manual: 'вручну', estimate: 'погоджена оцінка', hours: 'години × рейт' }

export default function InvoicingPage() {
  const [month, setMonth] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/invoicing${month ? `?month=${month}` : ''}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) setError(d.error ?? `HTTP ${r.status}`)
        else { setReport(d); setError('') }
      })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [month, nonce])

  const reload = () => setNonce(n => n + 1)

  async function setAmount(taskId: string, value: string) {
    const v = value.trim().replace(/\s/g, '').replace(',', '.')
    const res = await fetch('/api/invoicing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, amount: v === '' ? null : Number(v) }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? `HTTP ${res.status}`) }
    reload()
  }

  async function act(p: ProjectBlock, action: 'invoice' | 'reopen', createInvoice = false) {
    if (!report) return
    const label = monthLabel(report.month)
    if (createInvoice && !confirm(`Створити інвойс «${p.name} — ${label}»? Клієнт побачить його у своїй вкладці Invoices зі статусом «до оплати».`)) return
    setBusy(p.id + action)
    const res = await fetch('/api/invoicing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: p.id, month: report.month, action, createInvoice, title: `${p.name} — ${new Date(`${report.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` }),
    })
    setBusy(null)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? `HTTP ${res.status}`); return }
    reload()
  }

  const m = report?.month ?? month ?? ''
  // Totals for the month, per currency
  const totals = new Map<string, { open: number; invoiced: number; missing: number }>()
  for (const p of report?.projects ?? []) {
    const row = totals.get(p.currency) ?? { open: 0, invoiced: 0, missing: 0 }
    for (const l of p.lines) {
      if (l.amount == null) { if (!l.invoiced_at) row.missing++ }
      else if (l.invoiced_at) row.invoiced += l.amount
      else row.open += l.amount
    }
    totals.set(p.currency, row)
  }

  return (
    <div className="p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">До інвойсу</h1>
          <p className="text-sm text-gray-500 mt-0.5">Усе, що дійшло до «To be invoiced» за місяць. Клієнт бачить ці задачі просто як Done.</p>
        </div>
        {report && (
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            <button onClick={() => setMonth(shift(m, -1))} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Попередній місяць"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-gray-900 px-3 min-w-[150px] text-center">{monthLabel(m)}</span>
            <button onClick={() => setMonth(shift(m, 1))} disabled={m >= report.current} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30" title="Наступний місяць"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {report && !report.migrated && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
          Щоб задачі потрапляли в правильний місяць і їх можна було позначати виставленими, запусти міграцію supabase/invoicing_migration.sql.
        </p>
      )}

      {!report ? (
        <p className="text-sm text-gray-400">Завантажую…</p>
      ) : (
        <>
          {/* Month at a glance */}
          <div className="flex gap-3 flex-wrap mb-5">
            {[...totals.entries()].map(([cur, t]) => (
              <div key={cur} className="flex gap-3 flex-wrap">
                <div className="bg-gray-900 text-white rounded-2xl px-5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">До виставлення</p>
                  <p className="text-2xl font-bold">{money(t.open, cur)}</p>
                  {t.missing > 0 && <p className="text-[11px] text-amber-600">+ {t.missing} без суми</p>}
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl px-5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Уже виставлено</p>
                  <p className="text-2xl font-bold text-gray-900">{money(t.invoiced, cur)}</p>
                </div>
              </div>
            ))}
            {report.months.filter(x => x.month !== m && x.open > 0).slice(0, 4).map(x => (
              <button key={x.month} onClick={() => setMonth(x.month)} className="bg-amber-50 hover:bg-amber-100 rounded-2xl px-4 py-3 text-left transition-colors">
                <p className="text-[10px] uppercase tracking-wide text-amber-700">Не виставлено</p>
                <p className="text-sm font-semibold text-amber-800">{monthLabel(x.month)} · {x.open}</p>
              </button>
            ))}
          </div>

          {report.projects.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-gray-400">
              <FileText size={28} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">За {monthLabel(m).toLowerCase()} у «To be invoiced» нічого немає.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5 items-start">
              {report.projects.map(p => <InvoiceSheet key={p.id} p={p} month={m} busy={busy} onAmount={setAmount} onAct={act} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function InvoiceSheet({ p, month, busy, onAmount, onAct }: {
  p: ProjectBlock
  month: string
  busy: string | null
  onAmount: (taskId: string, value: string) => void
  onAct: (p: ProjectBlock, action: 'invoice' | 'reopen', createInvoice?: boolean) => void
}) {
  const open = p.lines.filter(l => !l.invoiced_at)
  const done = p.lines.filter(l => l.invoiced_at)
  const total = open.reduce((s, l) => s + (l.amount ?? 0), 0)
  const invoicedTotal = done.reduce((s, l) => s + (l.amount ?? 0), 0)
  const missing = open.filter(l => l.amount == null).length
  const allInvoiced = open.length === 0
  const hours = p.lines.reduce((s, l) => s + l.tracked_hours, 0)

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Invoice head */}
      <div className="px-6 pt-6 pb-5 border-b border-gray-100 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{allInvoiced ? 'Інвойс' : 'Інвойс · чернетка'}</p>
          <Link href={`/board/${p.id}`} className="flex items-center gap-2 mt-1.5 group">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color ?? '#9ca3af' }} />
            <h2 className="text-xl font-semibold text-gray-900 tracking-tight truncate group-hover:underline">{p.name}</h2>
          </Link>
          <p className="text-xs text-gray-500 mt-1.5">
            Кому: <span className="text-gray-800">{p.clients.length ? p.clients.join(', ') : 'клієнта не додано'}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Період</p>
          <p className="text-sm font-semibold text-gray-900">{monthLabel(month)}</p>
          <span className={`inline-block mt-1.5 text-[11px] font-medium rounded-md px-2 py-0.5 ${allInvoiced ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-50'}`}>
            {allInvoiced ? 'Виставлено' : 'До виставлення'}
          </span>
        </div>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="font-medium pl-6 pr-2 py-2.5 w-8">№</th>
              <th className="font-medium px-2 py-2.5">Задача</th>
              <th className="font-medium px-2 py-2.5 w-[86px]">Готово</th>
              <th className="font-medium px-2 py-2.5 w-[92px] text-right">Години</th>
              <th className="font-medium pl-2 pr-6 py-2.5 w-[150px] text-right">Сума, {SYMBOL[p.currency] ?? p.currency}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {p.lines.map((l, i) => (
              <tr key={l.id} className={l.invoiced_at ? 'text-gray-400' : ''}>
                <td className="pl-6 pr-2 py-3 text-xs text-gray-300 tabular-nums align-top">{i + 1}</td>
                <td className="px-2 py-3 align-top">
                  <p className={`text-sm font-medium ${l.invoiced_at ? 'text-gray-400' : 'text-gray-900'}`}>{l.title}</p>
                  <p className="text-[11px] text-gray-400">
                    {l.invoiced_at ? `виставлено ${new Date(l.invoiced_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}` : l.source ? SOURCE[l.source] : 'сума не вказана'}
                  </p>
                </td>
                <td className="px-2 py-3 text-xs text-gray-500 align-top whitespace-nowrap">{new Date(l.ready_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</td>
                <td className="px-2 py-3 text-xs text-gray-500 text-right align-top tabular-nums whitespace-nowrap">
                  {l.tracked_hours > 0 ? `${l.tracked_hours} год` : '—'}
                  {l.estimate_hours != null && <span className="block text-[10px] text-gray-300">оцінка {l.estimate_hours}</span>}
                </td>
                <td className="pl-2 pr-6 py-2.5 text-right align-top">
                  {l.invoiced_at ? (
                    <span className="text-sm font-semibold tabular-nums">{l.amount != null ? money(l.amount, p.currency) : '—'}</span>
                  ) : (
                    <AmountInput key={`${l.id}:${l.amount ?? ''}`} value={l.amount} missing={l.amount == null} label={l.title} onCommit={v => onAmount(l.id, v)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Total */}
      <div className="px-6 py-5 border-t border-gray-200 bg-gray-50 flex items-end justify-between gap-4 flex-wrap">
        <div className="text-xs text-gray-500">
          {p.lines.length} {p.lines.length === 1 ? 'задача' : 'задач'}{hours > 0 ? ` · ${Math.round(hours * 100) / 100} год затрекано` : ''}{p.rate ? ` · рейт ${money(p.rate, p.currency)}/год` : ''}
          {missing > 0 && <span className="block text-amber-700 mt-0.5">{missing} без суми — вкажи, щоб увійшли в підсумок</span>}
          {done.length > 0 && !allInvoiced && <span className="block mt-0.5">уже виставлено: {money(invoicedTotal, p.currency)}</span>}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{allInvoiced ? 'Виставлено' : 'До сплати'}</p>
          <p className="text-3xl font-bold text-gray-900 tracking-tight tabular-nums">{money(allInvoiced ? invoicedTotal : total, p.currency)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        {done.length > 0 && (
          <button onClick={() => onAct(p, 'reopen')} disabled={!!busy} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-2 py-1.5 mr-auto">
            <RotateCcw size={12} /> Повернути в невиставлені
          </button>
        )}
        {!allInvoiced && (
          <>
            <button onClick={() => onAct(p, 'invoice')} disabled={!!busy} className="flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:border-gray-900 rounded-lg px-3 py-2 transition-colors disabled:opacity-50">
              {busy === p.id + 'invoice' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Позначити як виставлено
            </button>
            <button onClick={() => onAct(p, 'invoice', true)} disabled={!!busy || total <= 0} className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 text-white rounded-lg px-3 py-2 transition-colors disabled:opacity-40">
              <FileText size={12} /> Створити інвойс клієнту
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function AmountInput({ value, missing, label, onCommit }: { value: number | null; missing: boolean; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value != null ? String(value) : '')
  return (
    <input
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== (value != null ? String(value) : '')) onCommit(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputMode="decimal"
      placeholder="сума"
      aria-label={`Сума: ${label}`}
      className={`w-28 text-sm font-semibold text-gray-900 text-right tabular-nums border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-400 ${missing ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}
    />
  )
}
