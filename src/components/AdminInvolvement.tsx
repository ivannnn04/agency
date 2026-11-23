'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UserRound } from 'lucide-react'

// Dashboard card: where the admin's own tracked time goes, per project —
// this month and overall, and how much of it is marked for invoicing.

interface MyTask { id: string; title: string; project_id: string | null; project: string; color: string | null; column: string | null; column_color: string | null; due_date: string | null }
interface Row { project_id: string | null; name: string; color: string | null; month: number; month_billable: number; total: number; total_billable: number }

const hours = (s: number) => {
  const h = s / 3600
  return h >= 10 ? `${Math.round(h)} год` : `${Math.round(h * 10) / 10} год`
}

export default function AdminInvolvement() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [mine, setMine] = useState<MyTask[]>([])
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/admin-time')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) { setRows(d?.projects ?? []); setMine(d?.my_tasks ?? []) } })
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
          <p className="text-xs text-gray-400 mt-0.5">Твій власний затреканий час і задачі, які ти взяв на себе. У зарплату не йде.</p>
        </div>
        <div className="flex gap-5 text-right">
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Цього місяця</p><p className="text-lg font-bold text-gray-900">{hours(month)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">З них інвойсимо</p><p className="text-lg font-bold text-gray-900">{hours(monthBill)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">За весь час</p><p className="text-lg font-bold text-gray-900">{hours(total)}</p></div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Ще нічого не затрекано. Відкрий задачу на дошці, натисни «+ Я» у виконавцях і «Старт» у блоці «Мій час».</p>
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
      {mine.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 mb-2">Мої задачі · {mine.length}</p>
          <div className="flex flex-col">
            {mine.map(t => {
              const overdue = !!t.due_date && t.due_date < new Date().toISOString().slice(0, 10)
              return (
                <Link key={t.id} href={t.project_id ? `/board/${t.project_id}?task=${t.id}` : '#'}
                  className="flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color ?? '#9ca3af' }} />
                  <span className="text-sm text-gray-800 flex-1 truncate">{t.title}</span>
                  <span className="text-xs text-gray-400 w-32 truncate hidden sm:block">{t.project}</span>
                  <span className={`text-xs tabular-nums w-16 text-right ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                    {t.due_date ? new Date(t.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : ''}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide w-36 text-right truncate" style={{ color: t.column_color ?? '#9ca3af' }}>{t.column ?? 'Без колонки'}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
