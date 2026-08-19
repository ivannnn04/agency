'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, Calendar, Flag, Clock, MessageSquare, X, FilePen, Paperclip, Loader2, CalendarDays,
  NotebookPen, Plus,
} from 'lucide-react'
import {
  MentionComposer, MessageBody, Attachment, fileTooBig, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips,
} from '@/components/chat/shared'
import GanttView from '@/components/GanttView'
import ThemeToggle from '@/components/ThemeToggle'
import ProjectNotepad from '@/components/ProjectNotepad'

interface PortalColumn { id: string; name: string; color: string; position: number }
interface PortalTask {
  id: string; title: string; description: string | null
  column_id: string | null; priority: string | null
  start_date: string | null; due_date: string | null
}
interface ChangeRequest {
  id: string
  task_id: string
  content: string
  files: { url: string; name: string }[]
  status: 'open' | 'done'
  created_at: string
}
interface PortalProjectData {
  project: {
    id: string; name: string; color: string | null; status: string
    contract_amount: number | null; contract_currency: string | null
    show_tracked_hours: boolean
    change_request_limit: number
  }
  columns: PortalColumn[]
  tasks: PortalTask[]
  assigneesByTask: Record<string, string[]>
  timeByTask: Record<string, number> | null
  people: string[]
  changeRequests: ChangeRequest[]
}
interface ChatMessage {
  id: string
  sender_type: 'admin' | 'team' | 'client' | 'bot'
  sender_name: string
  content: string
  file_url: string | null
  file_name: string | null
  created_at: string
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }
const PRIORITY_COLOR: Record<string, string> = { low: '#9CA3AF', medium: '#F59E0B', high: '#EF4444' }
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return '0m'
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function PortalProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [data, setData] = useState<PortalProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [view, setView] = useState<'board' | 'timeline'>('board')
  const [crTask, setCrTask] = useState<PortalTask | null>(null)

  const refetch = useCallback(async (accessToken: string) => {
    const res = await fetch(`/api/portal/project/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 401) { router.replace('/portal/login'); return }
    if (!res.ok) { setDenied(true); setLoading(false); return }
    setData(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/portal/login'); return }
      setToken(session.access_token)
      refetch(session.access_token)
    })()
  }, [id, router, refetch])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
  )

  if (denied || !data) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-gray-600 font-medium">You don’t have access to this project</p>
        <Link href="/portal" className="text-sm text-teal-600 hover:text-teal-700 mt-2 inline-block">← Back to your projects</Link>
      </div>
    </div>
  )

  const { project, columns, tasks, assigneesByTask, timeByTask, changeRequests } = data
  const sym = CURRENCY_SYMBOL[project.contract_currency ?? 'USD']
  const crLimit = project.change_request_limit ?? 3
  const crCountByTask: Record<string, number> = {}
  for (const cr of changeRequests ?? []) {
    crCountByTask[cr.task_id] = (crCountByTask[cr.task_id] ?? 0) + 1
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0f1117] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/portal" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project.color ?? '#14b8a6' }} />
          <p className="text-white font-semibold text-sm">{project.name}</p>
          {/* Board / Timeline switcher */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 ml-3">
            <button
              onClick={() => setView('board')}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'board' ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              Board
            </button>
            <button
              onClick={() => setView('timeline')}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'timeline' ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              Timeline
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle variant="sidebar" />
          <button
            onClick={() => setAddTaskOpen(true)}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            title="Add a task to the backlog"
          >
            <Plus size={13} /> Add task
          </button>
          <button
            onClick={() => { setChatOpen(false); setNotesOpen(v => !v) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              notesOpen ? 'bg-amber-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            <NotebookPen size={13} /> Notes
          </button>
          <button
            onClick={() => { setNotesOpen(false); setChatOpen(v => !v) }}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <MessageSquare size={13} /> Team chat
          </button>
        </div>
      </header>

      {view === 'timeline' ? (
        <div className="h-[calc(100vh-64px)] bg-white">
          <GanttView tasks={tasks} onUpdate={() => {}} readOnly />
        </div>
      ) : (
      <div className="px-6 py-6">
        {/* Budget */}
        {(project.contract_amount ?? 0) > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 inline-block">
            <p className="text-xs text-gray-400 mb-0.5">Project budget</p>
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
                    const used = crCountByTask[task.id] ?? 0
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
                              {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: PRIORITY_COLOR[task.priority ?? 'medium'] }}>
                            <Flag size={11} /> {PRIORITY_LABEL[task.priority ?? 'medium']}
                          </span>
                          {timeByTask && secs != null && secs > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-teal-600 font-medium">
                              <Clock size={11} /> {formatHours(secs)}
                            </span>
                          )}
                        </div>
                        {/* Change request */}
                        <button
                          onClick={() => setCrTask(task)}
                          disabled={used >= crLimit}
                          className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium border border-gray-200 rounded-lg py-1.5 text-gray-500 hover:text-teal-600 hover:border-teal-200 hover:bg-teal-50/50 disabled:opacity-40 disabled:hover:text-gray-500 disabled:hover:border-gray-200 disabled:hover:bg-transparent transition-colors"
                          title={used >= crLimit ? 'Change request limit reached — contact the team in chat' : 'Request changes on this task'}
                        >
                          <FilePen size={11} />
                          Request changes ({used}/{crLimit})
                        </button>
                      </div>
                    )
                  })}
                  {colTasks.length === 0 && <p className="text-xs text-gray-300 px-1">No tasks</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {crTask && token && (
        <ChangeRequestModal
          projectId={project.id}
          task={crTask}
          token={token}
          used={crCountByTask[crTask.id] ?? 0}
          limit={crLimit}
          onClose={() => setCrTask(null)}
          onSubmitted={() => { setCrTask(null); refetch(token) }}
        />
      )}

      {chatOpen && token && (
        <PortalChat
          projectId={project.id}
          token={token}
          people={data.people ?? []}
          onClose={() => setChatOpen(false)}
        />
      )}

      {notesOpen && token && (
        <ProjectNotepad
          projectId={project.id}
          viewer={{ type: 'client', name: '' }}
          portalToken={token}
          lang="en"
          onClose={() => setNotesOpen(false)}
        />
      )}

      {addTaskOpen && token && (
        <AddTaskModal
          projectId={project.id}
          token={token}
          onClose={() => setAddTaskOpen(false)}
          onCreated={() => { setAddTaskOpen(false); refetch(token) }}
        />
      )}
    </div>
  )
}

// ── Client adds a task (goes to the Backlog only) ──────────────────────────────

function AddTaskModal({ projectId, token, onClose, onCreated }: {
  projectId: string
  token: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const t = title.trim()
    if (!t || saving) return
    setSaving(true)
    setError('')
    const res = await fetch(`/api/portal/project/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: t, description: desc.trim() }),
    })
    setSaving(false)
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: 'Something went wrong' }))
      setError(err)
      return
    }
    onCreated()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add a task</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              It lands in the Backlog — the team will review and schedule it
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="What needs to be done?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Details (optional)</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              placeholder="Anything that helps the team understand the request"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !title.trim()}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? 'Adding...' : 'Add to Backlog'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Change request modal ───────────────────────────────────────────────────────

function ChangeRequestModal({ projectId, task, token, used, limit, onClose, onSubmitted }: {
  projectId: string
  task: PortalTask
  token: string
  used: number
  limit: number
  onClose: () => void
  onSubmitted: () => void
}) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list) return
    const picked = Array.from(list)
    for (const f of picked) {
      if (fileTooBig(f)) { setError(`"${f.name}" is too big — ${MAX_FILE_MB} MB max`); return }
    }
    setError('')
    setFiles(prev => [...prev, ...picked].slice(0, 5))
  }

  async function submit() {
    if ((!content.trim() && files.length === 0) || saving) return
    setSaving(true)
    setError('')
    const form = new FormData()
    form.append('taskId', task.id)
    form.append('content', content.trim())
    for (const f of files) form.append('files', f)
    const res = await fetch(`/api/portal/project/${projectId}/change-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    setSaving(false)
    if (res.ok) {
      onSubmitted()
    } else {
      const { error: err } = await res.json().catch(() => ({ error: 'Something went wrong' }))
      setError(err)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Request changes</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-sm">
              «{task.title}» · {used + 1} of {limit}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <textarea
            autoFocus
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={6}
            placeholder="Describe what you'd like to change..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none leading-relaxed"
          />

          {/* Files */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-teal-600 hover:text-teal-700 cursor-pointer w-fit">
              <Paperclip size={13} />
              Attach images or files (up to 5, {MAX_FILE_MB} MB each)
              <input
                type="file" multiple className="hidden"
                accept="*"
                onChange={e => { addFiles(e.target.files); e.target.value = '' }}
              />
            </label>
            {files.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-gray-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs text-gray-600 truncate">{f.name}</span>
                    <button
                      onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-300 hover:text-red-400 flex-shrink-0 ml-2"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || (!content.trim() && files.length === 0)}
            className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Client-side chat (talks to the portal API only) ────────────────────────────

function PortalChat({ projectId, token, people, onClose }: {
  projectId: string
  token: string
  people: string[]
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [bookingOpen, setBookingOpen] = useState(false)
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [myKey, setMyKey] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { width, startResize } = useChatWidth()

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/project/${projectId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { messages: msgs, reactions: rx, myKey: mk } = await res.json()
      setMessages(msgs)
      if (mk) setMyKey(mk)
      const map: Record<string, Reaction[]> = {}
      for (const r of (rx ?? []) as Reaction[]) {
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push(r)
      }
      setReactions(map)
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

  async function toggleReaction(messageId: string, emoji: string) {
    if (!myKey) return
    const has = (reactions[messageId] ?? []).some(r => r.emoji === emoji && r.reactor_key === myKey)
    setReactions(prev => ({
      ...prev,
      [messageId]: has
        ? (prev[messageId] ?? []).filter(r => !(r.emoji === emoji && r.reactor_key === myKey))
        : [...(prev[messageId] ?? []), { message_id: messageId, emoji, reactor_key: myKey, reactor_name: 'You' }],
    }))
    await fetch(`/api/portal/project/${projectId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId, emoji }),
    })
  }

  async function sendFile(f: File) {
    setError('')
    if (fileTooBig(f)) { setError(`File is too big — ${MAX_FILE_MB} MB max`); return }
    setUploading(true)
    const form = new FormData()
    form.append('file', f)
    form.append('content', input.trim())
    const res = await fetch(`/api/portal/project/${projectId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    setUploading(false)
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setInput('')
    } else {
      const { error: err } = await res.json().catch(() => ({ error: 'Upload failed' }))
      setError(err)
    }
  }

  return (
    <div
      className="fixed right-0 top-0 h-full bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width }}
    >
      <ChatResizeHandle onMouseDown={startResize} />
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-teal-500" />
          <p className="text-sm font-semibold text-gray-800">Team chat</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p className="text-xs text-gray-300 text-center mt-8">Write the first message — the team will see it right away</p>
        )}
        {messages.map(m => {
          const mine = m.sender_type === 'client'
          return (
            <div key={m.id} className={`max-w-[85%] group ${mine ? 'self-end' : 'self-start'}`}>
              {!mine && (
                <p className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {m.sender_name}
                  {m.sender_type === 'admin' && ' · Gudrix'}
                  {m.sender_type === 'bot' && (
                    <span className="ml-1 text-[9px] bg-violet-100 text-violet-700 px-1 py-px rounded font-bold uppercase tracking-wide">🤖 AI</span>
                  )}
                </p>
              )}
              <div className={`flex items-center gap-0.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  mine
                    ? 'bg-teal-500 text-white rounded-br-md'
                    : m.sender_type === 'bot'
                      ? 'bg-violet-50 text-gray-800 border border-violet-100 rounded-bl-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  <MessageBody content={m.content} names={people} mine={mine} />
                  {m.file_url && (
                    <Attachment url={m.file_url} name={m.file_name ?? 'file'} mine={mine} />
                  )}
                </div>
                <ReactionPicker mine={mine} onPick={emoji => toggleReaction(m.id, emoji)} />
              </div>
              <ReactionChips
                reactions={reactions[m.id] ?? []}
                myKey={myKey}
                onToggle={emoji => toggleReaction(m.id, emoji)}
                mine={mine}
              />
              <p className={`text-[10px] text-gray-300 mt-0.5 px-1 ${mine ? 'text-right' : ''}`}>
                {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="text-[11px] text-red-500 px-4 py-1.5 border-t border-red-100 bg-red-50 flex-shrink-0">{error}</p>
      )}

      <MentionComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onPickFile={sendFile}
        people={people.map(name => ({ name, type: 'team' as const }))}
        placeholder="Message... (@ to mention)"
        uploading={uploading}
        accent="teal"
        onBookMeeting={() => setBookingOpen(true)}
      />

      {bookingOpen && <BookMeetingModal onClose={() => setBookingOpen(false)} />}
    </div>
  )
}

// ── Cal.com booking popup ──────────────────────────────────────────────────────

const CAL_EMBED_SNIPPET = `
(function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api;p(cal.ns[namespace], ar);p(cal, ["initNamespace", namespace]);} else p(cal, ar); return;} p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");
Cal("init", "meeting", {origin:"https://app.cal.com"});
Cal.config = Cal.config || {};
Cal.config.forwardQueryParams = true;
Cal.ns.meeting("inline", {
  elementOrSelector: "#portal-cal-inline",
  config: {"layout":"month_view","useSlotsViewOnSmallScreen":"true"},
  calLink: "ivan-fantalin-gudrix/meeting",
});
Cal.ns.meeting("ui", {"hideEventTypeDetails":false,"layout":"month_view"});
`

function BookMeetingModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.textContent = CAL_EMBED_SNIPPET
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-teal-500" />
            <p className="text-sm font-semibold text-gray-800">Book a meeting with Gudrix</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-hidden">
          <div id="portal-cal-inline" style={{ width: '100%', height: '100%', overflow: 'scroll' }} />
        </div>
      </div>
    </div>
  )
}
