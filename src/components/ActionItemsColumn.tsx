'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Video, X } from 'lucide-react'
import { PMTask } from '@/types/pm'

// The board's virtual column of action items taken from the project's calls
// (Fellow). They are proposals: approving one turns it into a real To-Do
// task, dismissing removes it. The column disappears when nothing waits.

export interface ProposedAction {
  id: string
  title: string
  details: string | null
  owner: string | null
  due_date: string | null
  meeting_title: string
  meeting_at: string | null
}

export const ACTIONS_CHANGED = 'gudrix:actions-changed'
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '')

export async function decideAction(id: string, decision: 'approve' | 'dismiss' | 'restore', edits?: { title?: string; details?: string }) {
  const res = await fetch('/api/projects/action-items', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, decision, ...edits }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
  return d as { item: { id: string; status: string; task_id: string | null }; task?: PMTask }
}

export default function ActionItemsColumn({ projectId, onTaskCreated }: {
  projectId: string
  onTaskCreated: (task: PMTask) => void
}) {
  const [items, setItems] = useState<ProposedAction[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/projects/action-items?project=${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setItems(d?.items ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId, nonce])

  useEffect(() => {
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener(ACTIONS_CHANGED, refresh)
    return () => window.removeEventListener(ACTIONS_CHANGED, refresh)
  }, [])

  const decide = useCallback(async (item: ProposedAction, decision: 'approve' | 'dismiss') => {
    setBusy(item.id); setError('')
    try {
      const r = await decideAction(item.id, decision, decision === 'approve' ? { title: titles[item.id] ?? item.title } : undefined)
      if (r.task) onTaskCreated(r.task)
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }, [titles, onTaskCreated])

  async function approveAll() {
    for (const item of items) await decide(item, 'approve')
  }

  if (items.length === 0) return null

  return (
    <div className="flex-shrink-0 w-[300px] flex flex-col rounded-xl bg-sky-50/70 border border-sky-100 p-2.5">
      <div className="flex items-center gap-2 px-1 mb-1">
        <div className="w-3 h-3 rounded-full bg-sky-600" />
        <span className="text-xs font-bold tracking-wide uppercase text-sky-700">Action items</span>
        <span className="text-xs text-gray-400 font-medium">{items.length}</span>
        {items.length > 1 && (
          <button onClick={approveAll} disabled={!!busy} className="ml-auto text-[11px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-40">
            Апрувнути всі
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 px-1 mb-3 leading-snug">
        Із дзвінків (Fellow). Апрувни — і картка піде в To-Do; команда бачить лише апрувнуті.
      </p>

      <div className="flex flex-col gap-2">
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
            <textarea
              value={titles[item.id] ?? item.title}
              onChange={e => setTitles(prev => ({ ...prev, [item.id]: e.target.value }))}
              rows={2}
              className="w-full text-sm text-gray-800 leading-snug resize-none focus:outline-none focus:bg-gray-50 rounded -mx-1 px-1"
              aria-label="Назва задачі"
            />
            {item.details && (
              <p onClick={() => setOpen(open === item.id ? null : item.id)}
                className={`text-xs text-gray-500 leading-relaxed mt-1 cursor-pointer ${open === item.id ? '' : 'line-clamp-2'}`}>
                {item.details}
              </p>
            )}
            <p className="flex items-center gap-1 text-[11px] text-gray-400 mt-2 min-w-0">
              <Video size={11} className="flex-shrink-0" />
              <span className="truncate">{item.meeting_title}{item.meeting_at ? ` · ${day(item.meeting_at)}` : ''}</span>
            </p>
            {(item.owner || item.due_date) && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                {item.owner ? `Взяв: ${item.owner}` : ''}{item.owner && item.due_date ? ' · ' : ''}{item.due_date ? `до ${day(item.due_date)}` : ''}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2.5">
              <button onClick={() => decide(item, 'approve')} disabled={!!busy || !(titles[item.id] ?? item.title).trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors">
                {busy === item.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} У To-Do
              </button>
              <button onClick={() => decide(item, 'dismiss')} disabled={!!busy} title="Відхилити"
                className="flex items-center justify-center gap-1 text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40 transition-colors">
                <X size={12} /> Ні
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-2 px-1">{error}</p>}
    </div>
  )
}
