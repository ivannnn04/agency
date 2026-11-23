'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, ListChecks, Loader2, MessagesSquare, RefreshCw, Unlink, Video, X,
} from 'lucide-react'
import { PMTask } from '@/types/pm'
import { ACTIONS_CHANGED, decideAction } from '@/components/ActionItemsColumn'

// Everything said between us and the client of a project, in one timeline:
// the letters (pulled from the mailbox) and the calls (Fellow) with their
// full notes and the action items taken from them.

interface Meeting { id: string; title: string; started_at: string | null; attendees: string[]; recap?: string | null; transcript?: string | null }
interface Email {
  id: string
  direction: 'in' | 'out'
  subject: string | null
  body: string | null
  from_email: string | null
  to_email: string | null
  sent_at: string
  automated: boolean
  source: 'project' | 'lead'
}
interface Action {
  id: string
  meeting_id: string
  title: string
  details: string | null
  owner: string | null
  due_date: string | null
  status: 'proposed' | 'approved' | 'dismissed'
}
interface Comms {
  emails: Email[]
  actions: Action[]
  needsMigration: boolean
  mail: { configured: boolean; last_synced_at: string | null; last_error: string | null }
  ai: boolean
}

const AUTO_SYNC_AFTER_MS = 15 * 60 * 1000
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const ago = (iso: string | null) => {
  if (!iso) return 'ще не синхронізовано'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'щойно'
  if (min < 60) return `${min} хв тому`
  if (min < 60 * 24) return `${Math.round(min / 60)} год тому`
  return `${Math.round(min / 60 / 24)} дн тому`
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data as T
}

// Fellow's notes arrive as "## heading" and "- bullet" lines
function Recap({ text }: { text: string }) {
  return (
    <>
      {text.trim().split('\n').map((line, i) => {
        const t = line.trim()
        if (!t) return null
        const heading = t.match(/^#{2,3}\s+(.*)$/)
        if (heading) return <p key={i} className={`font-semibold text-gray-900 ${i > 0 ? 'mt-2.5' : ''}`}>{heading[1]}</p>
        if (t.startsWith('- ')) return <p key={i} className="pl-3 -indent-3 mt-0.5">• {t.slice(2)}</p>
        return <p key={i} className="mt-0.5">{t}</p>
      })}
    </>
  )
}

export default function ProjectComms({ projectId, meetings, candidates, fellow, onAttach, onReload, onTaskCreated }: {
  projectId: string
  meetings: Meeting[]
  candidates: Meeting[]
  fellow: { configured: boolean; last_synced_at: string | null; last_error: string | null }
  onAttach: (meetingId: string, projectId: string | null) => void
  onReload: () => void
  onTaskCreated?: (task: PMTask) => void
}) {
  const [data, setData] = useState<Comms | null>(null)
  const [filter, setFilter] = useState<'all' | 'mail' | 'calls'>('all')
  const [showAuto, setShowAuto] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [transcriptFor, setTranscriptFor] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const autoSynced = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await call<Comms>(`/api/projects/comms?project=${projectId}`)
      setData(d)
      return d
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [projectId])

  const sync = useCallback(async (quiet = false) => {
    setSyncing(true)
    if (!quiet) { setError(''); setNote('') }
    try {
      const r = await call<{ mail: { imported: number } | null; fellow: { imported: number } | null; actions: { created: number }; errors: string[] }>(
        '/api/projects/comms', 'POST', { action: 'sync' })
      if (!quiet) {
        setNote(`Нових листів: ${r.mail?.imported ?? 0} · нових дзвінків: ${r.fellow?.imported ?? 0} · нових action items: ${r.actions?.created ?? 0}`)
        if (r.errors.length) setError(r.errors.join(' · '))
      }
      if ((r.actions?.created ?? 0) > 0) window.dispatchEvent(new Event(ACTIONS_CHANGED))
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    }
    setSyncing(false)
    onReload()
    load()
  }, [load, onReload])

  useEffect(() => {
    let alive = true
    call<Comms>(`/api/projects/comms?project=${projectId}`).then(d => {
      if (!alive) return
      setData(d)
      // Opening the page brings the history up to date without being asked
      if (d.needsMigration || autoSynced.current === projectId) return
      const last = d.mail.last_synced_at ? new Date(d.mail.last_synced_at).getTime() : 0
      if (d.mail.configured && Date.now() - last > AUTO_SYNC_AFTER_MS) {
        autoSynced.current = projectId
        sync(true)
      }
    }).catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [projectId, sync])

  async function extract(meetingId: string) {
    setBusy(meetingId); setError(''); setNote('')
    try {
      const r = await call<{ created: number; skipped?: string }>('/api/projects/comms', 'POST', { action: 'extract', meetingId })
      setNote(r.skipped ? `Нічого не додано: ${r.skipped}` : r.created > 0 ? `Нових action items: ${r.created}` : 'Нових action items у цьому дзвінку немає')
      if (r.created > 0) window.dispatchEvent(new Event(ACTIONS_CHANGED))
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  async function decide(a: Action, decision: 'approve' | 'dismiss' | 'restore') {
    setBusy(a.id); setError('')
    try {
      const r = await decideAction(a.id, decision)
      if (r.task) onTaskCreated?.(r.task)
      setData(prev => prev ? { ...prev, actions: prev.actions.map(x => x.id === a.id ? { ...x, status: r.item.status as Action['status'] } : x) } : prev)
      window.dispatchEvent(new Event(ACTIONS_CHANGED))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  const emails = (data?.emails ?? []).filter(e => showAuto || !e.automated)
  const autoCount = (data?.emails ?? []).filter(e => e.automated).length
  const actionsOf = (meetingId: string) => (data?.actions ?? []).filter(a => a.meeting_id === meetingId)
  const waiting = (data?.actions ?? []).filter(a => a.status === 'proposed').length

  type Entry = { kind: 'mail'; at: string; mail: Email } | { kind: 'call'; at: string; call: Meeting }
  const entries: Entry[] = [
    ...(filter !== 'calls' ? emails.map(mail => ({ kind: 'mail' as const, at: mail.sent_at, mail })) : []),
    ...(filter !== 'mail' ? meetings.map(c => ({ kind: 'call' as const, at: c.started_at ?? '', call: c })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const chip = (key: typeof filter, label: string) => (
    <button onClick={() => setFilter(key)}
      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${filter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'}`}>
      {label}
    </button>
  )

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
          <MessagesSquare size={13} /> Комунікація з клієнтом
        </p>
        {waiting > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 rounded-full px-2 py-0.5">
            <ListChecks size={11} /> {waiting} action items чекають апруву
          </span>
        )}
        <button onClick={() => sync()} disabled={syncing} className="ml-auto flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Синхронізація…' : 'Синхронізувати'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Пошта: {data ? (data.mail.configured ? ago(data.mail.last_synced_at) : 'не підключена') : '…'} · Fellow: {fellow.configured ? ago(fellow.last_synced_at) : 'не підключено'}
      </p>

      {data?.needsMigration && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
          Щоб бачити листи й action items, запусти міграцію supabase/project_comms_migration.sql у Supabase SQL Editor.
        </p>
      )}
      {(data?.mail.last_error || fellow.last_error) && (
        <p className="text-xs text-red-600 mb-2">{[data?.mail.last_error, fellow.last_error].filter(Boolean).join(' · ')}</p>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {note && <p className="text-xs text-emerald-700 mb-2">{note}</p>}

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chip('all', `Усе · ${emails.length + meetings.length}`)}
        {chip('mail', `Листи · ${emails.length}`)}
        {chip('calls', `Дзвінки · ${meetings.length}`)}
        {autoCount > 0 && (
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 ml-1 cursor-pointer select-none">
            <input type="checkbox" checked={showAuto} onChange={e => setShowAuto(e.target.checked)} className="accent-gray-900" />
            автолисти платформи ({autoCount})
          </label>
        )}
        {candidates.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) onAttach(e.target.value, projectId) }}
            className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 max-w-[240px] focus:outline-none">
            <option value="">Додати дзвінок до проєкту…</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{when(c.started_at)} · {c.title}</option>)}
          </select>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 leading-relaxed">
          Тут зʼявляться листи з клієнтами цього проєкту (за їхніми емейлами з розділу «Клієнти») і дзвінки з Fellow.
          Дзвінки привʼязуються самі, коли серед учасників є email клієнта або назва проєкту є в назві зустрічі.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(en => {
            if (en.kind === 'mail') {
              const e = en.mail
              const open = openId === e.id
              const incoming = e.direction === 'in'
              return (
                <div key={`m-${e.id}`} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div onClick={() => setOpenId(open ? null : e.id)} className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${incoming ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                      {incoming ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{e.subject?.trim() || '(без теми)'}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {incoming ? `Клієнт → ми · ${e.from_email ?? ''}` : `Ми → клієнт · ${e.to_email ?? ''}`}
                        {!open && e.body?.trim() ? ` · ${e.body.trim().replace(/\s+/g, ' ').slice(0, 90)}` : ''}
                      </p>
                    </div>
                    {e.automated && <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 flex-shrink-0">авто</span>}
                    {e.source === 'lead' && <span className="text-[9px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 rounded px-1.5 py-0.5 flex-shrink-0">до старту</span>}
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{when(e.sent_at)}</span>
                  </div>
                  {open && (
                    <div className="px-3 pb-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
                        {e.body?.trim() || 'Лист без тексту.'}
                      </div>
                    </div>
                  )}
                </div>
              )
            }
            const mt = en.call
            const open = openId === mt.id
            const actions = actionsOf(mt.id)
            const proposed = actions.filter(a => a.status === 'proposed').length
            return (
              <div key={`c-${mt.id}`} className="border border-gray-100 rounded-xl overflow-hidden">
                <div onClick={() => { setOpenId(open ? null : mt.id); setTranscriptFor(null) }} className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                  <span className="w-6 h-6 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0"><Video size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{mt.title}</p>
                    <p className="text-[11px] text-gray-400 truncate">Дзвінок{mt.attendees.length > 0 ? ` · ${mt.attendees.join(', ')}` : ''}</p>
                  </div>
                  {proposed > 0 && <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 rounded-full px-2 py-0.5 flex-shrink-0">{proposed} на апрув</span>}
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{when(mt.started_at)}</span>
                  <button onClick={ev => { ev.stopPropagation(); if (window.confirm('Відвʼязати цей дзвінок від проєкту?')) onAttach(mt.id, null) }}
                    className="text-gray-300 hover:text-red-400 p-1 flex-shrink-0" title="Відвʼязати від проєкту">
                    <Unlink size={12} />
                  </button>
                  {open ? <ChevronDown size={13} className="text-gray-300 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />}
                </div>
                {open && (
                  <div className="px-3 pb-3 flex flex-col gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Самарі</p>
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed max-h-80 overflow-y-auto">
                      {mt.recap?.trim() ? <Recap text={mt.recap} /> : 'Fellow ще не згенерував нотатки для цього дзвінка.'}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Action items · {actions.length}</p>
                      <button onClick={() => extract(mt.id)} disabled={busy === mt.id}
                        className="ml-auto flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
                        {busy === mt.id ? <Loader2 size={11} className="animate-spin" /> : <ListChecks size={11} />}
                        {actions.length ? 'Перечитати дзвінок' : 'Витягнути action items'}
                      </button>
                    </div>
                    {actions.length === 0 ? (
                      <p className="text-xs text-gray-400">Поки немає. Вони зʼявляються самі після синхронізації нового дзвінка.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {actions.map(a => (
                          <div key={a.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${a.status === 'proposed' ? 'border-sky-100 bg-sky-50/50' : 'border-gray-100'}`}>
                            <div className="min-w-0 flex-1">
                              <p className={`text-xs font-medium leading-snug ${a.status === 'dismissed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{a.title}</p>
                              {a.details && a.status !== 'dismissed' && <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{a.details}</p>}
                              {(a.owner || a.due_date) && a.status !== 'dismissed' && (
                                <p className="text-[11px] text-gray-400 mt-0.5">{[a.owner ? `Взяв: ${a.owner}` : '', a.due_date ? `до ${a.due_date}` : ''].filter(Boolean).join(' · ')}</p>
                              )}
                            </div>
                            {a.status === 'proposed' ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => decide(a, 'approve')} disabled={busy === a.id}
                                  className="flex items-center gap-1 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-2 py-1 text-[11px] font-medium">
                                  {busy === a.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} У To-Do
                                </button>
                                <button onClick={() => decide(a, 'dismiss')} disabled={busy === a.id} title="Відхилити"
                                  className="text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg p-1 disabled:opacity-40"><X size={11} /></button>
                              </div>
                            ) : a.status === 'approved' ? (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 flex-shrink-0"><Check size={11} /> у To-Do</span>
                            ) : (
                              <button onClick={() => decide(a, 'restore')} disabled={busy === a.id} className="text-[11px] text-gray-400 hover:text-gray-700 underline flex-shrink-0">повернути</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {mt.transcript?.trim() && (
                      <>
                        <button onClick={() => setTranscriptFor(transcriptFor === mt.id ? null : mt.id)} className="self-start text-xs font-medium text-gray-500 hover:text-gray-900 mt-1">
                          {transcriptFor === mt.id ? 'Сховати транскрипт' : 'Показати транскрипт'}
                        </button>
                        {transcriptFor === mt.id && (
                          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{mt.transcript}</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
