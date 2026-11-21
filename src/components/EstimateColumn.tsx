'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PMColumn, PMTask } from '@/types/pm'
import { Check, Loader2, MessageSquareWarning, Send, Trash2, UserRound } from 'lucide-react'

// The virtual first column of a board: tasks a client has asked for that
// still need an estimate or the client's approval of it. They carry no
// column until the client approves — then they land in To-Do. The column
// disappears when there is nothing to estimate.

const PENDING = ['needed', 'sent', 'changes']
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export const isEstimatePending = (t: { estimate_status?: string | null }) => PENDING.includes(t.estimate_status ?? '')

export default function EstimateColumn({ tasks, columns, currency, byName, canApprove, onTaskChange, onTaskRemoved }: {
  tasks: PMTask[]
  columns: PMColumn[]
  currency?: string | null
  byName: string
  canApprove: boolean
  onTaskChange: (task: PMTask) => void
  onTaskRemoved: (taskId: string) => void
}) {
  const pending = tasks.filter(isEstimatePending)
  if (pending.length === 0) return null

  return (
    <div className="flex-shrink-0 w-[300px] flex flex-col rounded-xl bg-violet-50/60 border border-violet-100 p-2.5">
      <div className="flex items-center gap-2 px-1 mb-1">
        <div className="w-3 h-3 rounded-full bg-violet-600" />
        <span className="text-xs font-bold tracking-wide uppercase text-violet-700">To be estimated</span>
        <span className="text-xs text-gray-400 font-medium">{pending.length}</span>
      </div>
      <p className="text-[11px] text-gray-500 px-1 mb-3 leading-snug">
        Задачі від клієнта. Оціни й надішли оцінку — у To-Do задача піде, коли клієнт погодить.
      </p>
      <div className="flex flex-col gap-2.5">
        {pending.map(task => (
          <EstimateCard
            key={task.id}
            task={task}
            columns={columns}
            symbol={SYMBOL[currency ?? 'USD'] ?? ''}
            byName={byName}
            canApprove={canApprove}
            onTaskChange={onTaskChange}
            onTaskRemoved={onTaskRemoved}
          />
        ))}
      </div>
    </div>
  )
}

function EstimateCard({ task, columns, symbol, byName, canApprove, onTaskChange, onTaskRemoved }: {
  task: PMTask
  columns: PMColumn[]
  symbol: string
  byName: string
  canApprove: boolean
  onTaskChange: (task: PMTask) => void
  onTaskRemoved: (taskId: string) => void
}) {
  const [hours, setHours] = useState(task.estimate_hours != null ? String(task.estimate_hours) : '')
  const [cost, setCost] = useState(task.estimate_cost != null ? String(task.estimate_cost) : '')
  const [note, setNote] = useState(task.estimate_note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const num = (v: string) => { const n = Number(v.replace(',', '.')); return v.trim() && Number.isFinite(n) && n > 0 ? n : null }
  const draft = { estimate_hours: num(hours), estimate_cost: num(cost), estimate_note: note.trim() || null }
  const dirty = draft.estimate_hours !== (task.estimate_hours ?? null)
    || draft.estimate_cost !== (task.estimate_cost ?? null)
    || draft.estimate_note !== (task.estimate_note ?? null)
  const canSend = draft.estimate_hours != null || draft.estimate_cost != null

  async function save(): Promise<boolean> {
    if (!dirty) return true
    const { error } = await supabase.from('pm_tasks').update({ ...draft, estimate_by: byName }).eq('id', task.id)
    if (error) {
      setMsg({ ok: false, text: /estimate_|schema cache/i.test(error.message) ? 'Запусти міграцію supabase/estimate_flow_migration.sql' : error.message })
      return false
    }
    onTaskChange({ ...task, ...draft, estimate_by: byName })
    return true
  }

  async function send() {
    if (!canSend || busy) return
    setBusy(true); setMsg(null)
    if (!await save()) { setBusy(false); return }
    const res = await fetch('/api/team/estimate-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg({ ok: false, text: d.error ?? `HTTP ${res.status}` }); return }
    onTaskChange({ ...task, ...draft, estimate_by: byName, estimate_status: 'sent', estimate_sent_at: new Date().toISOString() })
    setMsg(d.mailError
      ? { ok: false, text: `Оцінка в кабінеті клієнта, але лист не пішов: ${d.mailError}` }
      : { ok: true, text: `Надіслано клієнту${d.sent > 1 ? ` (${d.sent} листи)` : ''}` })
  }

  async function approveWithoutClient() {
    const target = columns.find(c => /to.?do|backlog|беклог/i.test(c.name)) ?? columns[0]
    if (!target) { setMsg({ ok: false, text: 'На дошці немає колонок' }); return }
    if (!confirm(`Перенести «${task.title}» у ${target.name} без погодження клієнта?`)) return
    setBusy(true)
    const patch = { ...draft, estimate_status: 'approved' as const, estimate_decided_at: new Date().toISOString(), column_id: target.id }
    const { error } = await supabase.from('pm_tasks').update(patch).eq('id', task.id)
    setBusy(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    // A priced estimate extends the project budget, same as a client approval
    if (patch.estimate_cost && task.finance_project_id) {
      await fetch('/api/projects/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: task.finance_project_id, taskId: task.id }),
      }).catch(() => {})
      window.dispatchEvent(new Event('gudrix:budget-changed'))
    }
    onTaskChange({ ...task, ...patch })
  }

  async function remove() {
    if (!confirm(`Видалити задачу «${task.title}»?`)) return
    const { error } = await supabase.from('pm_tasks').delete().eq('id', task.id)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    onTaskRemoved(task.id)
  }

  const status = task.estimate_status
  const field = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200'

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
        {canApprove && (
          <button onClick={remove} className="text-gray-300 hover:text-red-500 flex-shrink-0 mt-0.5" title="Видалити задачу">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {task.description && <p className="text-xs text-gray-500 mt-1 line-clamp-3 whitespace-pre-line">{task.description}</p>}

      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">
          <UserRound size={10} /> від клієнта
        </span>
        {status === 'needed' && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">Потрібна оцінка</span>}
        {status === 'sent' && (
          <span className="text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
            Чекаємо на клієнта{task.estimate_sent_at ? ` · ${new Date(task.estimate_sent_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}` : ''}
          </span>
        )}
        {status === 'changes' && <span className="text-[10px] font-medium text-red-600 bg-red-50 rounded px-1.5 py-0.5">Клієнт просить змінити</span>}
      </div>

      {status === 'changes' && task.estimate_client_comment && (
        <div className="mt-2 flex gap-2 bg-red-50 border border-red-100 rounded-lg p-2">
          <MessageSquareWarning size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 whitespace-pre-line">{task.estimate_client_comment}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="block">
          <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Години</span>
          <input value={hours} onChange={e => setHours(e.target.value)} onBlur={save} inputMode="decimal" placeholder="8" className={field} />
        </label>
        <label className="block">
          <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Вартість{symbol ? `, ${symbol}` : ''}</span>
          <input value={cost} onChange={e => setCost(e.target.value)} onBlur={save} inputMode="decimal" placeholder="необовʼязково" className={field} />
        </label>
      </div>
      <label className="block mt-2">
        <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Коментар для клієнта</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={save} rows={2} placeholder="Що входить в оцінку" className={`${field} resize-none`} />
      </label>

      <button
        onClick={send}
        disabled={!canSend || busy}
        className="mt-2.5 w-full flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg py-2 text-xs font-medium transition-colors"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {status === 'sent' ? 'Надіслати оцінку ще раз' : status === 'changes' ? 'Надіслати оновлену оцінку' : 'Надіслати оцінку клієнту'}
      </button>
      {canApprove && (
        <button onClick={approveWithoutClient} disabled={busy} className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-900 py-1 transition-colors">
          <Check size={11} /> У To-Do без погодження клієнта
        </button>
      )}
      {msg && <p className={`text-[11px] mt-1.5 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
