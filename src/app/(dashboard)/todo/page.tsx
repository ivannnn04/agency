'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Plus, Trash2, Play, Pause, CheckCircle2, Circle, ChevronDown, ChevronRight,
  Sparkles, Loader2, Timer, Clock, Inbox, Zap, Eye, Moon, Archive, X, Edit2, Check
} from 'lucide-react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

type Bucket = 'inbox' | 'next' | 'waiting' | 'someday' | 'done'

interface Todo {
  id: string
  title: string
  bucket: Bucket
  context?: string
  energy?: 'high' | 'low'
  estimated_min?: number
  time_spent_sec: number
  completed_at?: string
  created_at: string
  notes?: string
}

const BUCKETS: { key: Bucket; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'inbox',   label: 'Вхідні',         icon: <Inbox size={15} />,    color: 'text-blue-500' },
  { key: 'next',    label: 'Наступні дії',    icon: <Zap size={15} />,      color: 'text-green-500' },
  { key: 'waiting', label: 'Очікую',          icon: <Eye size={15} />,      color: 'text-amber-500' },
  { key: 'someday', label: 'Колись/Можливо', icon: <Moon size={15} />,     color: 'text-purple-500' },
  { key: 'done',    label: 'Виконано',        icon: <Archive size={15} />,  color: 'text-gray-400' },
]

const ENERGY_LABELS = { high: '⚡ Висока', low: '🌙 Низька' }
const CONTEXTS = ['Комп\'ютер', 'Телефон', 'Зустріч', 'Вулиця', 'Офіс']

function fmt(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}г ${m}хв`
  if (m > 0) return `${m}хв ${s}с`
  return `${s}с`
}

function fmtShort(min?: number) {
  if (!min) return '—'
  if (min < 60) return `${min}хв`
  return `${Math.floor(min / 60)}г${min % 60 ? ` ${min % 60}хв` : ''}`
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [activeBucket, setActiveBucket] = useState<Bucket>('inbox')
  const [collapsed, setCollapsed] = useState<Record<Bucket, boolean>>({
    inbox: false, next: false, waiting: false, someday: false, done: true,
  })
  const [capture, setCapture] = useState('')
  const [estMin, setEstMin] = useState('')
  const [context, setContext] = useState('')
  const [energy, setEnergy] = useState<'high' | 'low' | ''>('')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [timerRunning, setTimerRunning] = useState<string | null>(null) // todo id
  const [timerBase, setTimerBase] = useState(0)
  const [timerStart, setTimerStart] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('todos').select('*').order('created_at', { ascending: false })
    if (data) setTodos(data as Todo[])
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTodos(prev => prev.map(t =>
          t.id === timerRunning
            ? { ...t, time_spent_sec: timerBase + Math.floor((Date.now() - (timerStart ?? Date.now())) / 1000) }
            : t
        ))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timerRunning, timerBase, timerStart])

  async function addTodo() {
    if (!capture.trim()) return
    const { data } = await supabase.from('todos').insert({
      title: capture.trim(),
      bucket: activeBucket === 'done' ? 'inbox' : activeBucket,
      context: context || null,
      energy: energy || null,
      estimated_min: estMin ? parseInt(estMin) : null,
      time_spent_sec: 0,
    }).select().single()
    if (data) {
      setTodos(prev => [data as Todo, ...prev])
      setCapture('')
      setEstMin('')
      setContext('')
      setEnergy('')
    }
  }

  async function moveBucket(id: string, bucket: Bucket) {
    const completed_at = bucket === 'done' ? new Date().toISOString() : null
    await supabase.from('todos').update({ bucket, completed_at }).eq('id', id)
    setTodos(prev => prev.map(t => t.id === id ? { ...t, bucket, completed_at: completed_at ?? undefined } : t))
    if (timerRunning === id && bucket === 'done') stopTimer(id)
  }

  async function deleteTodo(id: string) {
    if (timerRunning === id) stopTimer(id)
    await supabase.from('todos').delete().eq('id', id)
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  function startTimer(todo: Todo) {
    if (timerRunning && timerRunning !== todo.id) stopTimer(timerRunning)
    setTimerBase(todo.time_spent_sec)
    setTimerStart(Date.now())
    setTimerRunning(todo.id)
  }

  async function stopTimer(id: string) {
    if (timerRef.current) clearInterval(timerRef.current)
    const todo = todos.find(t => t.id === id)
    if (todo) {
      await supabase.from('todos').update({ time_spent_sec: todo.time_spent_sec }).eq('id', id)
    }
    setTimerRunning(null)
    setTimerStart(null)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return
    await supabase.from('todos').update({ title: editTitle.trim() }).eq('id', id)
    setTodos(prev => prev.map(t => t.id === id ? { ...t, title: editTitle.trim() } : t))
    setEditingId(null)
  }

  async function runAnalysis() {
    setAnalyzing(true)
    setAnalysisOpen(true)
    try {
      const res = await fetch('/api/todos/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: todos }),
      })
      const d = await res.json()
      setAnalysis(d.analysis ?? d.error ?? 'Помилка')
    } catch {
      setAnalysis('Помилка при аналізі')
    } finally {
      setAnalyzing(false)
    }
  }

  const bucketTodos = (bucket: Bucket) => todos.filter(t => t.bucket === bucket)
  const totalSpent = todos.reduce((s, t) => s + t.time_spent_sec, 0)
  const doneCount = bucketTodos('done').length
  const nextCount = bucketTodos('next').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">To-Do List</h1>
          <p className="text-sm text-gray-500 mt-0.5">Getting Things Done • {doneCount} виконано • {nextCount} в роботі • {fmt(totalSpent)} відтрековано</p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing || todos.length === 0}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          AI-аналіз
        </button>
      </div>

      {/* Quick capture */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
        <div className="flex gap-2 mb-3">
          <input
            ref={captureRef}
            value={capture}
            onChange={e => setCapture(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTodo()}
            onFocus={() => setCaptureOpen(true)}
            placeholder="Швидке захоплення… (Enter щоб додати)"
            className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-violet-400"
          />
          <button
            onClick={addTodo}
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
          >
            <Plus size={15} /> Додати
          </button>
        </div>

        {captureOpen && (
          <div className="flex flex-wrap gap-2 items-center">
            {/* Bucket selector */}
            <div className="flex gap-1">
              {BUCKETS.filter(b => b.key !== 'done').map(b => (
                <button
                  key={b.key}
                  onClick={() => setActiveBucket(b.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeBucket === b.key ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-gray-300" />

            {/* Estimate */}
            <input
              type="number"
              value={estMin}
              onChange={e => setEstMin(e.target.value)}
              placeholder="хв"
              className="w-16 bg-white border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 outline-none focus:ring-1 focus:ring-violet-400"
            />

            {/* Context */}
            <select
              value={context}
              onChange={e => setContext(e.target.value)}
              className="bg-white border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">Контекст</option>
              {CONTEXTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Energy */}
            <div className="flex gap-1">
              {(['high', 'low'] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setEnergy(prev => prev === e ? '' : e)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    energy === e ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {ENERGY_LABELS[e]}
                </button>
              ))}
            </div>

            <button onClick={() => setCaptureOpen(false)} className="ml-auto text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Bucket columns */}
      <div className="space-y-3">
        {BUCKETS.map(({ key, label, icon, color }) => {
          const items = bucketTodos(key)
          const isCollapsed = collapsed[key]
          return (
            <div key={key} className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Bucket header */}
              <button
                onClick={() => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className={`flex items-center gap-2 font-medium text-sm ${color}`}>
                  {icon}
                  <span className="text-gray-800">{label}</span>
                  <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                    {items.length}
                  </span>
                </div>
                {isCollapsed ? <ChevronRight size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
              </button>

              {!isCollapsed && (
                <div className="divide-y divide-gray-100">
                  {items.length === 0 && (
                    <p className="text-gray-400 text-sm text-center py-6">Порожньо</p>
                  )}
                  {items.map(todo => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      isRunning={timerRunning === todo.id}
                      editingId={editingId}
                      editTitle={editTitle}
                      setEditTitle={setEditTitle}
                      onStartEdit={() => { setEditingId(todo.id); setEditTitle(todo.title) }}
                      onSaveEdit={() => saveEdit(todo.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onStartTimer={() => startTimer(todo)}
                      onStopTimer={() => stopTimer(todo.id)}
                      onMoveBucket={moveBucket}
                      onDelete={() => deleteTodo(todo.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* AI Analysis modal */}
      {analysisOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                <Sparkles size={18} className="text-violet-600" />
                AI-аналіз продуктивності CEO
              </div>
              <button onClick={() => setAnalysisOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {analyzing ? (
                <div className="flex flex-col items-center justify-center h-40 gap-3 text-gray-500">
                  <Loader2 size={32} className="animate-spin text-violet-600" />
                  <p className="text-sm">Аналізую ваші задачі…</p>
                </div>
              ) : (
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {analysis.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={i}>{part.slice(2, -2)}</strong>
                      : part
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TodoRow({
  todo, isRunning, editingId, editTitle, setEditTitle,
  onStartEdit, onSaveEdit, onCancelEdit,
  onStartTimer, onStopTimer, onMoveBucket, onDelete,
}: {
  todo: Todo
  isRunning: boolean
  editingId: string | null
  editTitle: string
  setEditTitle: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  onMoveBucket: (id: string, b: Bucket) => void
  onDelete: () => void
}) {
  const isDone = todo.bucket === 'done'

  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 group transition-colors ${isDone ? 'opacity-60' : ''}`}>
      {/* Complete toggle */}
      <button
        onClick={() => onMoveBucket(todo.id, isDone ? 'inbox' : 'done')}
        className="shrink-0 text-gray-300 hover:text-green-500 transition-colors"
      >
        {isDone
          ? <CheckCircle2 size={18} className="text-green-500" />
          : <Circle size={18} />
        }
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        {editingId === todo.id ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
              className="flex-1 border border-violet-400 rounded px-2 py-0.5 text-sm text-gray-900 outline-none"
            />
            <button onClick={onSaveEdit} className="text-green-600 hover:text-green-700"><Check size={15} /></button>
            <button onClick={onCancelEdit} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm text-gray-800 ${isDone ? 'line-through' : ''}`}>{todo.title}</span>
            {todo.context && (
              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">@{todo.context}</span>
            )}
            {todo.energy && (
              <span className="text-xs">{ENERGY_LABELS[todo.energy as 'high' | 'low']}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 mt-0.5">
          {todo.estimated_min && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock size={10} /> est {fmtShort(todo.estimated_min)}
            </span>
          )}
          {todo.time_spent_sec > 0 && (
            <span className={`text-xs flex items-center gap-1 ${isRunning ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
              <Timer size={10} /> {fmt(todo.time_spent_sec)}
            </span>
          )}
        </div>
      </div>

      {/* Move bucket */}
      <select
        value={todo.bucket}
        onChange={e => onMoveBucket(todo.id, e.target.value as Bucket)}
        className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white outline-none hidden group-hover:block"
      >
        {BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
      </select>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isDone && (
          <button
            onClick={isRunning ? onStopTimer : onStartTimer}
            className={`p-1.5 rounded-md transition-colors ${isRunning ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
            title={isRunning ? 'Зупинити таймер' : 'Запустити таймер'}
          >
            {isRunning ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}
        <button
          onClick={onStartEdit}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Редагувати"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          title="Видалити"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
