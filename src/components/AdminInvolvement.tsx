'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UserRound } from 'lucide-react'

// Dashboard card: where the admin's own tracked time goes, per project —
// this month and overall, and how much of it is marked for invoicing.

interface Row { project_id: string | null; name: string; color: string | null; month: number; month_billable: number; total: number; total_billable: number }

const hours = (s: number) => {
  const h = s / 3600
  return h >= 10 ? `${Math.round(h)} год` : `${Math.round(h * 10) / 10} год`
}

export default function AdminInvolvement() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/admin-time')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setRows(d?.projects ?? []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [nonce])

  useEffect(() => {
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener('gudrix:admin-time-changed', refresh)
    return () => window.removeEventListener('gudrix:admin-time-changed', refresh)
  }, [])

  if (!rows) return null
  const month = rows.reduce((s, r) => s + r.month, 0), monthBill = rows.reduce((s, r) => s + r.month_billable, 0)
  const total = rows.reduce((s, r) => s + r.total, 0)
  const max = Math.max(1, ...rows.map(r => r.month))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><UserRound size={15} className="text-gray-400" /> Моя залученість</p>
          <p className="text-xs text-gray-400 mt-0.5">Твій власний затреканий час по проєктах. У зарплату не йде.</p>
        </div>
        <div className="flex gap-5 text-right">
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Цього місяця</p><p className="text-lg font-bold text-gray-900">{hours(month)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">З них інвойсимо</p><p className="text-lg font-bold text-gray-900">{hours(monthBill)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">За весь час</p><p className="text-lg font-bold text-gray-900">{hours(total)}</p></div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Ще нічого не затрекано. Відкрий задачу на дошці й натисни «Старт» у блоці «Мій час».</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => (
            <div key={r.project_id ?? 'none'} className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.color ?? '#9ca3af' }} />
              {r.project_id
                ? <Link href={`/board/${r.project_id}`} className="text-sm text-gray-800 w-44 truncate hover:underline">{r.name}</Link>
                : <span className="text-sm text-gray-500 w-44 truncate">{r.name}</span>}
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full" style={{ width: `${((r.month || 0) / max) * 100}%` }} />
              </div>
              <span className={`text-sm font-semibold w-20 text-right tabular-nums ${r.month > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{r.month > 0 ? hours(r.month) : '—'}</span>
              <span className="text-xs text-gray-400 w-52 text-right tabular-nums whitespace-nowrap hidden sm:block">
                усього {hours(r.total)}{r.total_billable > 0 ? ` · інв. ${hours(r.total_billable)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
