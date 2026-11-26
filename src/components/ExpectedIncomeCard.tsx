'use client'

import Link from 'next/link'
import { ArrowUpRight, CalendarClock } from 'lucide-react'
import { useRates } from '@/lib/use-rates'
import { cleanComment, daysUntil, payments, useExpectedIncome } from '@/lib/expectedIncome'

// Dashboard card: how much money is expected from projects, in total and per
// currency, and the next payments by date. Opens the full list.

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const money = (n: number, c: string) => (SYMBOL[c] ?? '') + Math.round(n).toLocaleString('en-US')

export default function ExpectedIncomeCard() {
  const { rows } = useExpectedIncome()
  const { toEUR } = useRates()
  if (!rows) return null
  const total = rows.reduce((s, r) => s + toEUR(Number(r.amount), r.currency), 0)
  const byCur: Record<string, number> = {}
  for (const r of rows) byCur[r.currency] = (byCur[r.currency] ?? 0) + Number(r.amount)
  const next = rows.slice(0, 5)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><CalendarClock size={15} className="text-gray-400" /> Очікувані надходження</p>
          <p className="text-xs text-gray-400 mt-0.5">Що має зайти, коли проєкти закриються. Дати орієнтовні.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">≈ {money(total, 'EUR')}</p>
          <p className="text-xs text-gray-500">{Object.entries(byCur).map(([c, n]) => money(n, c)).join(' + ') || '—'} · {payments(rows.length)}</p>
        </div>
      </div>
      {next.length > 0 && (
        <div className="flex flex-col">
          {next.map(r => {
            const d = daysUntil(r.date)
            return (
              <div key={r.id} className="flex items-center gap-3 py-1.5 border-t border-gray-50 first:border-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.project?.color ?? '#d4d4d8' }} />
                <span className="text-sm text-gray-800 flex-1 truncate">{r.project?.name ?? cleanComment(r.comment)}</span>
                <span className={`text-xs tabular-nums ${d < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {new Date(r.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums w-20 text-right">{money(Number(r.amount), r.currency)}</span>
              </div>
            )
          })}
        </div>
      )}
      <Link href="/expected" className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 mt-3">
        Усі очікувані надходження <ArrowUpRight size={12} />
      </Link>
    </div>
  )
}
