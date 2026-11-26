'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronDown, Clock, PenLine, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { cleanComment, payments, useExpectedIncome } from '@/lib/expectedIncome'

// The three headline numbers of the analytics page, each opening its
// breakdown, and a period for what came in:
// - Має надійти: the expected income list (planned incomes), reconciled by hand
// - Надійшло: actual income in the chosen period (with expenses and profit)
// - Sales amount: signed contracts with nothing received yet

type Preset = '7d' | '30d' | 'month' | 'prev' | '90d' | 'year' | 'custom'
const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 днів' }, { key: '30d', label: '30 днів' }, { key: 'month', label: 'Цей місяць' },
  { key: 'prev', label: 'Минулий місяць' }, { key: '90d', label: '90 днів' }, { key: 'year', label: 'Цей рік' }, { key: 'custom', label: 'Свій період' },
]

interface ProjectRow { id: string; name: string; color: string | null; contract_amount: number | null; contract_currency: string | null; received_before_app: number | null; status: string }
interface TxRow { type: 'income' | 'expense'; amount: number; currency: string; project_id: string | null; date: string }

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const money = (n: number, c = 'EUR') => (SYMBOL[c] ?? '') + Math.round(n).toLocaleString('en-US')
const dayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function rangeOf(p: Preset, from: string, to: string): { start: Date; end: Date; label: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const back = (n: number) => { const d = new Date(tomorrow); d.setDate(d.getDate() - n); return d }
  const fmt = (d: Date) => d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
  switch (p) {
    case '7d': return { start: back(7), end: tomorrow, label: 'за останні 7 днів' }
    case '30d': return { start: back(30), end: tomorrow, label: 'за останні 30 днів' }
    case '90d': return { start: back(90), end: tomorrow, label: 'за останні 90 днів' }
    case 'month': return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow, label: `за ${today.toLocaleDateString('uk-UA', { month: 'long' })}` }
    case 'prev': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return { start: s, end: new Date(today.getFullYear(), today.getMonth(), 1), label: `за ${s.toLocaleDateString('uk-UA', { month: 'long' })}` }
    }
    case 'year': return { start: new Date(today.getFullYear(), 0, 1), end: tomorrow, label: `за ${today.getFullYear()} рік` }
    case 'custom': {
      const s = from ? new Date(from + 'T00:00:00') : back(30)
      const e = to ? new Date(to + 'T00:00:00') : new Date(today)
      const end = new Date(e); end.setDate(end.getDate() + 1)
      return { start: s, end, label: `${fmt(s)} — ${fmt(e)}` }
    }
  }
}

export default function AnalyticsHeadline() {
  const { toEUR, loading: ratesLoading } = useRates()
  const { rows: expected } = useExpectedIncome()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [txs, setTxs] = useState<TxRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [preset, setPreset] = useState<Preset>('month')
  const [from, setFrom] = useState(() => dayIso(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(() => dayIso(new Date()))
  const [open, setOpen] = useState<'expected' | 'revenue' | 'sales' | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('projects').select('id, name, color, contract_amount, contract_currency, received_before_app, status').neq('status', 'archived'),
      supabase.from('transactions').select('type, amount, currency, project_id, date').in('type', ['income', 'expense']).eq('is_planned', false),
    ]).then(([p, t]) => {
      if (!alive) return
      setProjects((p.data ?? []) as ProjectRow[])
      setTxs((t.data ?? []) as TxRow[])
      setLoaded(true)
    })
    return () => { alive = false }
  }, [])

  const loading = !loaded || ratesLoading || expected === null
  const nameOf = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const range = rangeOf(preset, from, to)

  // ── Має надійти: the expected income list ──
  const exp = expected ?? []
  const expTotal = exp.reduce((s, r) => s + toEUR(Number(r.amount), r.currency), 0)
  const expByCur: Record<string, number> = {}
  for (const r of exp) expByCur[r.currency] = (expByCur[r.currency] ?? 0) + Number(r.amount)
  const expByProject = new Map<string, { name: string; color: string | null; eur: number; cur: Record<string, number>; n: number; next: string }>()
  for (const r of exp) {
    const key = r.project_id ?? `c:${cleanComment(r.comment)}`
    const g = expByProject.get(key) ?? { name: r.project?.name ?? (cleanComment(r.comment) || 'Без проєкту'), color: r.project?.color ?? null, eur: 0, cur: {}, n: 0, next: r.date }
    g.eur += toEUR(Number(r.amount), r.currency); g.cur[r.currency] = (g.cur[r.currency] ?? 0) + Number(r.amount); g.n++
    if (r.date < g.next) g.next = r.date
    expByProject.set(key, g)
  }

  // Received per project (for budgets and sales)
  const receivedByProject: Record<string, number> = {}
  for (const t of txs) if (t.type === 'income' && t.project_id) receivedByProject[t.project_id] = (receivedByProject[t.project_id] ?? 0) + toEUR(t.amount, t.currency)

  // What the card used to show: budgets in projects minus what came in
  const budgets = projects
    .filter(p => Number(p.contract_amount) > 0)
    .map(p => {
      const cur = p.contract_currency ?? 'USD'
      const contract = toEUR(Number(p.contract_amount), cur)
      const received = toEUR(Number(p.received_before_app ?? 0), cur) + (receivedByProject[p.id] ?? 0)
      return { p, contract, received, left: Math.max(0, contract - received) }
    })
  const budgetLeft = budgets.filter(b => b.left > 0.5)
  const sales = budgets.filter(b => b.received < 0.5)

  // ── Надійшло за період ──
  const inRange = txs.filter(t => { const d = new Date(t.date); return d >= range.start && d < range.end })
  const income = inRange.filter(t => t.type === 'income')
  const revenue = income.reduce((s, t) => s + toEUR(t.amount, t.currency), 0)
  const expenses = inRange.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)
  const revByProject = new Map<string, { eur: number; n: number }>()
  for (const t of income) {
    const key = t.project_id ?? 'none'
    const g = revByProject.get(key) ?? { eur: 0, n: 0 }
    g.eur += toEUR(t.amount, t.currency); g.n++
    revByProject.set(key, g)
  }

  const tile = (key: 'expected' | 'revenue' | 'sales', cls: string, icon: React.ReactNode, title: string, value: string, sub: string) => (
    <button
      onClick={() => setOpen(o => (o === key ? null : key))}
      aria-expanded={open === key}
      className={`text-left rounded-2xl p-6 border transition-all ${cls} ${open === key ? 'ring-2 ring-offset-2 ring-gray-900' : 'hover:shadow-md'}`}
    >
      <div className="flex items-center gap-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-80">{icon} {title}</div>
      <p className="text-3xl font-bold">{loading ? '…' : value}</p>
      <p className="text-xs opacity-70 mt-1">{loading ? '' : sub}</p>
      <p className="text-[11px] font-medium mt-3 flex items-center gap-1 opacity-70">
        {open === key ? 'Сховати' : 'Деталі'} <ChevronDown size={12} className={`transition-transform ${open === key ? 'rotate-180' : ''}`} />
      </p>
    </button>
  )

  const row = (k: string, name: string, color: string | null, right: React.ReactNode, sub?: string) => (
    <div key={k} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color ?? '#d4d4d8' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{name}</p>
        {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
      </div>
      <div className="text-right text-sm font-semibold text-gray-900 tabular-nums flex-shrink-0">{right}</div>
    </div>
  )

  return (
    <div className="mb-8">
      {/* Period for what came in */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => setPreset(p.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${preset === p.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'}`}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="З дати"
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900" />
            —
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="По дату"
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tile('expected', 'bg-amber-50 border-amber-100 text-amber-700', <Clock size={16} />, 'Має надійти з проєктів',
          `≈ ${money(expTotal)}`,
          `${payments(exp.length)} · ${Object.entries(expByCur).map(([c, n]) => money(n, c)).join(' + ') || '—'}`)}
        {tile('revenue', 'bg-teal-50 border-teal-100 text-teal-700', <Wallet size={16} />, 'Надійшло',
          money(revenue),
          `${range.label} · витрати ${money(expenses)} · прибуток ${money(revenue - expenses)}`)}
        {tile('sales', 'bg-blue-50 border-blue-100 text-blue-700', <PenLine size={16} />, 'Sales amount',
          money(sales.reduce((s, b) => s + b.contract, 0)),
          `підписані контракти без жодної оплати — ${sales.length}`)}
      </div>

      {open && !loading && (
        <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-5">
          {open === 'expected' && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <p className="text-sm font-semibold text-gray-900">Очікувані платежі по проєктах</p>
                <Link href="/expected" className="text-xs font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1">
                  Відкрити очікувані надходження <ArrowUpRight size={12} />
                </Link>
              </div>
              {[...expByProject.entries()].sort((a, b) => b[1].eur - a[1].eur).map(([k, g]) =>
                row(k, g.name, g.color,
                  <>{Object.entries(g.cur).map(([c, n]) => money(n, c)).join(' + ')}{Object.keys(g.cur).some(c => c !== 'EUR') && <span className="block text-[11px] text-gray-400 font-normal">≈ {money(g.eur)}</span>}</>,
                  `${g.n > 1 ? `${payments(g.n)} · ` : ''}очікується ${new Date(g.next).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}`))}
              {exp.length === 0 && <p className="text-sm text-gray-400 py-2">Очікуваних платежів немає.</p>}

              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-900">Для звірки: залишки бюджетів у проєктах — {money(budgetLeft.reduce((s, b) => s + b.left, 0))}</p>
                <p className="text-xs text-gray-500 mt-1 mb-2">
                  Бюджет проєкту мінус уже отримане. Раніше ця картка показувала саме цю суму. Якщо бюджет проєкту застарів,
                  онови його на дошці проєкту: «Звіт» → «Бюджет».
                </p>
                {budgetLeft.sort((a, b) => b.left - a.left).map(b =>
                  row(b.p.id, b.p.name, b.p.color, money(b.left), `бюджет ${money(b.contract)} · отримано ${money(b.received)}`))}
              </div>
            </>
          )}

          {open === 'revenue' && (
            <>
              <p className="text-sm font-semibold text-gray-900 mb-2">Надходження {range.label}, по проєктах</p>
              {[...revByProject.entries()].sort((a, b) => b[1].eur - a[1].eur).map(([k, g]) => {
                const p = nameOf.get(k)
                return row(k, p?.name ?? 'Без проєкту', p?.color ?? null, money(g.eur), payments(g.n))
              })}
              {income.length === 0 && <p className="text-sm text-gray-400 py-2">За цей період надходжень немає.</p>}
              <div className="flex items-center justify-between text-sm mt-3 pt-3 border-t border-gray-100">
                <span className="text-gray-500">Витрати {range.label}</span><span className="font-semibold text-red-500 tabular-nums">{money(expenses)}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-gray-500">Прибуток</span><span className={`font-semibold tabular-nums ${revenue - expenses >= 0 ? 'text-gray-900' : 'text-red-500'}`}>{money(revenue - expenses)}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Усе в євро за курсом НБУ. Окремі платежі — на сторінці «Платежі» з фільтром дат.</p>
            </>
          )}

          {open === 'sales' && (
            <>
              <p className="text-sm font-semibold text-gray-900 mb-1">Підписані контракти, по яких ще не було жодної оплати</p>
              <p className="text-xs text-gray-500 mb-2">Сума — бюджет проєкту. Якщо бюджет застарів, онови його в «Звіт» → «Бюджет».</p>
              {sales.sort((a, b) => b.contract - a.contract).map(b => row(b.p.id, b.p.name, b.p.color, money(b.contract)))}
              {sales.length === 0 && <p className="text-sm text-gray-400 py-2">Таких контрактів немає.</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
