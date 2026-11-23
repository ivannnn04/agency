'use client'

import { useEffect, useState } from 'react'
import { Clock, Play, Plus, Square, X } from 'lucide-react'

// The admin's own time on a task: timer, manual entry, and whether this time
// goes on the client's invoice. It is the admin's private record — it never
// reaches payroll or the team's workload.

interface Entry { id: string; started_at: string; duration_seconds: number | null }
interface State { total_seconds: number; running: { id: string; started_at: string } | null; entries: Entry[]; billable: boolean }

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m} хв`
  return m > 0 ? `${h} год ${m} хв` : `${h} год`
}
const clock = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')

export default function AdminTaskTime({ taskId }: { taskId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    fetch(`/api/admin-time?task=${taskId}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!alive) return; if (r.ok) setState(d); else setError(d.error ?? `HTTP ${r.status}`) })
      .catch(() => {})
    return () => { alive = false }
  }, [taskId])

  // Tick while the timer runs
  const runningSince = state?.running?.started_at ?? null
  useEffect(() => {
    if (!runningSince) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningSince])

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true); setError('')
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return false }
    setState(d); setNow(Date.now())
    window.dispatchEvent(new Event('gudrix:admin-time-changed'))
    return true
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault()
    const hours = Number(manual.replace(',', '.'))
    if (!manual.trim() || !Number.isFinite(hours) || hours <= 0) { setError('Вкажи години, наприклад 1.5'); return }
    if (await call('POST', '/api/admin-time', { taskId, action: 'add', seconds: Math.round(hours * 3600) })) setManual('')
  }

  const elapsed = runningSince ? Math.max(0, Math.round((now - new Date(runningSince).getTime()) / 1000)) : 0
  const total = (state?.total_seconds ?? 0) + elapsed

  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 flex items-center gap-1.5"><Clock size={11} /> Мій час</p>
          <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5">{total > 0 ? fmt(total) : '—'}</p>
        </div>
        {runningSince ? (
          <button onClick={() => call('POST', '/api/admin-time', { taskId, action: 'stop' })} disabled={busy}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-full pl-3 pr-4 py-2 text-sm font-medium tabular-nums transition-colors disabled:opacity-50">
            <Square size={12} fill="currentColor" /> {clock(elapsed)}
          </button>
        ) : (
          <button onClick={() => call('POST', '/api/admin-time', { taskId, action: 'start' })} disabled={busy || !state}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 text-white rounded-full pl-3 pr-4 py-2 text-sm font-medium transition-colors disabled:opacity-50">
            <Play size={12} fill="currentColor" /> Старт
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <form onSubmit={addManual} className="flex items-center gap-1.5">
          <input value={manual} onChange={e => setManual(e.target.value)} inputMode="decimal" placeholder="1.5" aria-label="Додати години вручну"
            className="w-14 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <span className="text-xs text-gray-400">год</span>
          <button type="submit" disabled={busy || !state} className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40">
            <Plus size={12} /> додати вручну
          </button>
        </form>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={state?.billable ?? false} disabled={busy || !state}
            onChange={e => call('PATCH', '/api/admin-time', { taskId, billable: e.target.checked })} className="accent-gray-900" />
          Інвойсити мій час
        </label>
      </div>

      {state && state.entries.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setOpen(v => !v)} className="text-[11px] text-gray-400 hover:text-gray-600">
            {open ? 'Сховати записи' : `Записи: ${state.entries.length}`}
          </button>
          {open && (
            <div className="flex flex-col gap-0.5 mt-1">
              {state.entries.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="w-24">{new Date(e.started_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</span>
                  <span className="flex-1">{fmt(e.duration_seconds ?? 0)}</span>
                  <button onClick={() => call('DELETE', `/api/admin-time?id=${e.id}&task=${taskId}`)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Видалити запис"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-2">Тільки для тебе: у зарплату й завантаженість команди не потрапляє.</p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
