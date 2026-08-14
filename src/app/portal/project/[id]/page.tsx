'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Calendar, Flag, Clock, Send, MessageSquare, X } from 'lucide-react'

interface PortalColumn { id: string; name: string; color: string; position: number }
interface PortalTask {
  id: string; title: string; description: string | null
  column_id: string | null; priority: string | null; due_date: string | null
}
interface PortalProjectData {
  project: {
    id: string; name: string; color: string | null; status: string
    contract_amount: number | null; contract_currency: string | null
    show_tracked_hours: boolean
  }
  columns: PortalColumn[]
  tasks: PortalTask[]
  assigneesByTask: Record<string, string[]>
  timeByTask: Record<string, number> | null
}
interface ChatMessage {
  id: string
  sender_type: 'admin' | 'team' | 'client'
  sender_name: string
  content: string
  created_at: string
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const PRIORITY_COLOR: Record<string, string> = { low: '#9CA3AF', medium: '#F59E0B', high: '#EF4444' }

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return '0хв'
  if (h === 0) return `${m}хв`
  return m > 0 ? `${h}г ${m}хв` : `${h}г`
}

export default function PortalProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [data, setData] = useState<PortalProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/portal/login'); return }
      setToken(session.access_token)

      const res = await fetch(`/api/portal/project/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 401) { router.replace('/portal/login'); return }
      if (!res.ok) { setDenied(true); setLoading(false); return }
      setData(await res.json())
      setLoading(false)
    })()
  }, [id, router])

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center text-gray-400 text-sm">Завантаження...</div>
  )

  if (denied || !data) return (
    <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-gray-600 font-medium">Немає доступу до цього проєкту</p>
        <Link href="/portal" className="text-sm text-teal-600 hover:text-teal-700 mt-2 inline-block">← До ваших проєктів</Link>
      </div>
    </div>
  )

  const { project, columns, tasks, assigneesByTask, timeByTask } = data
  const sym = CURRENCY_SYMBOL[project.contract_currency ?? 'USD']

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-[#0f1117] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/portal" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project.color ?? '#14b8a6' }} />
          <p className="text-white font-semibold text-sm">{project.name}</p>
        </div>
        <button
          onClick={() => setChatOpen(v => !v)}
          className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          <MessageSquare size={13} /> Чат з командою
        </button>
      </header>

      <div className="px-6 py-6">
        {/* Budget */}
        {(project.contract_amount ?? 0) > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 inline-block">
            <p className="text-xs text-gray-400 mb-0.5">Бюджет проєкту</p>
            <p className="text-xl font-bold text-gray-900">
              {sym}{project.contract_amount!.toLocaleString('en-US')}
            </p>
          </div>
        )}

        {/* Read-only board */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.column_id === col.id)
            return (
              <div key={col.id} className="flex-shrink-0 w-[280px] flex flex-col">
                <div className="flex items-center gap-2 px-1 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-xs font-bold tracking-wide uppercase" style={{ color: col.color }}>{col.name}</span>
                  <span className="text-xs text-gray-400 font-medium">{colTasks.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {colTasks.map(task => {
                    const names = assigneesByTask[task.id] ?? []
                    const secs = timeByTask?.[task.id]
                    return (
                      <div key={task.id} className="bg-white rounded-xl border border-gray-100 p-3.5">
                        <p className="text-sm text-gray-800 leading-snug">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{task.description}</p>
                        )}
                        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-2.5">
                          {names.length > 0 && (
                            <span className="text-[11px] text-gray-500">{names.join(', ')}</span>
                          )}
                          {task.due_date && (
                            <span className="flex items-center gap-1 text-[11px] text-gray-400">
                              <Calendar size={11} />
                              {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          <Flag size={11} style={{ color: PRIORITY_COLOR[task.priority ?? 'medium'] }} />
                          {timeByTask && secs != null && secs > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-teal-600 font-medium">
                              <Clock size={11} /> {formatHours(secs)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {colTasks.length === 0 && <p className="text-xs text-gray-300 px-1">Немає задач</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {chatOpen && token && (
        <PortalChat projectId={project.id} token={token} onClose={() => setChatOpen(false)} />
      )}
    </div>
  )
}

// ── Client-side chat (talks to the portal API only) ────────────────────────────

function PortalChat({ projectId, token, onClose }: {
  projectId: string
  token: string
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/project/${projectId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { messages: msgs } = await res.json()
      setMessages(msgs)
    }
  }, [projectId, token])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    const res = await fetch(`/api/portal/project/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: text }),
    })
    setSending(false)
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setInput('')
    }
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[380px] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-teal-500" />
          <p className="text-sm font-semibold text-gray-800">Чат з командою</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p className="text-xs text-gray-300 text-center mt-8">Напишіть перше повідомлення — команда побачить його одразу</p>
        )}
        {messages.map(m => {
          const mine = m.sender_type === 'client'
          return (
            <div key={m.id} className={`max-w-[85%] ${mine ? 'self-end' : 'self-start'}`}>
              {!mine && (
                <p className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {m.sender_name}{m.sender_type === 'admin' ? ' · Gudrix' : ''}
                </p>
              )}
              <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                mine ? 'bg-teal-500 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                {m.content}
              </div>
              <p className={`text-[10px] text-gray-300 mt-0.5 px-1 ${mine ? 'text-right' : ''}`}>
                {new Date(m.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 p-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={2}
          placeholder="Повідомлення..."
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors flex-shrink-0"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}
