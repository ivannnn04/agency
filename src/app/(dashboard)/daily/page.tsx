'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Check, ChevronLeft, ChevronRight, Flame, NotebookPen, CalendarDays } from 'lucide-react'

// «Мій день» — the admin's personal daily page: habit tracker
// (done / not done per day), a to-do list for the day, and a free-form
// notepad for thoughts.

interface Habit { id: string; name: string; color: string; position: number }
interface Todo { id: string; day: string; title: string; done: boolean }

const HABIT_COLORS = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#ec4899']

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

const WEEKDAY = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export default function DailyPage() {
  const today = isoDay(new Date())

  const [habits, setHabits] = useState<Habit[]>([])
  // habit_id -> set of all checked days
  const [checks, setChecks] = useState<Record<string, Set<string>>>({})
  const [newHabit, setNewHabit] = useState('')
  const [addingHabit, setAddingHabit] = useState(false)
  // Expanded mini-calendar: which habit + which month (first day of month)
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null)
  const [calMonth, setCalMonth] = useState(() => today.slice(0, 7)) // YYYY-MM

  const [day, setDay] = useState(today)
  const [todos, setTodos] = useState<Todo[]>([])
  const [newTodo, setNewTodo] = useState('')

  // Daily journal: one note per day, stored in personal_notes with id = YYYY-MM-DD
  const [noteDay, setNoteDay] = useState(today)
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  const [recentNotes, setRecentNotes] = useState<string[]>([])
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dbError, setDbError] = useState('')

  // Last 7 days, oldest first, ending today
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))

  const loadHabits = useCallback(async () => {
    const { data: hs, error } = await supabase
      .from('habits')
      .select('id, name, color, position')
      .order('position')
      .order('created_at')
    if (error) { setDbError('Запусти міграцію daily_migration.sql'); return }
    setHabits((hs ?? []) as Habit[])
    // All history — the per-habit mini calendar can browse any month
    const { data: cs } = await supabase
      .from('habit_checks')
      .select('habit_id, day')
    const map: Record<string, Set<string>> = {}
    for (const c of (cs ?? []) as { habit_id: string; day: string }[]) {
      if (!map[c.habit_id]) map[c.habit_id] = new Set()
      map[c.habit_id].add(c.day)
    }
    setChecks(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadTodos = useCallback(async (d: string) => {
    const { data } = await supabase
      .from('daily_todos')
      .select('id, day, title, done')
      .eq('day', d)
      .order('created_at')
    setTodos((data ?? []) as Todo[])
  }, [])

  const loadRecentNotes = useCallback(async () => {
    const { data } = await supabase
      .from('personal_notes')
      .select('id, content')
      .like('id', '20%')
      .order('id', { ascending: false })
      .limit(30)
    setRecentNotes(
      ((data ?? []) as { id: string; content: string | null }[])
        .filter(r => (r.content ?? '').trim() !== '')
        .map(r => r.id)
    )
  }, [])

  useEffect(() => {
    loadHabits()
    loadRecentNotes()
  }, [loadHabits, loadRecentNotes])

  useEffect(() => { loadTodos(day) }, [day, loadTodos])

  // Load the journal entry for the selected day
  useEffect(() => {
    ;(async () => {
      if (notesTimer.current) clearTimeout(notesTimer.current)
      const { data } = await supabase
        .from('personal_notes')
        .select('content')
        .eq('id', noteDay)
        .maybeSingle()
      setNotes(data?.content ?? '')
      setNotesSaved(true)
    })()
  }, [noteDay])

  // ── Habits ────────────────────────────────────────────────────────────────

  async function addHabit() {
    const name = newHabit.trim()
    if (!name) return
    const color = HABIT_COLORS[habits.length % HABIT_COLORS.length]
    const { data, error } = await supabase
      .from('habits')
      .insert({ name, color, position: habits.length })
      .select('id, name, color, position')
      .single()
    if (error) { setDbError('Запусти міграцію daily_migration.sql'); return }
    if (data) setHabits(prev => [...prev, data as Habit])
    setNewHabit('')
    setAddingHabit(false)
  }

  async function deleteHabit(id: string) {
    if (!window.confirm('Видалити звичку разом з історією?')) return
    setHabits(prev => prev.filter(h => h.id !== id))
    await supabase.from('habits').delete().eq('id', id)
  }

  async function toggleCheck(habitId: string, d: string) {
    const has = checks[habitId]?.has(d)
    setChecks(prev => {
      const next = { ...prev, [habitId]: new Set(prev[habitId] ?? []) }
      if (has) next[habitId].delete(d)
      else next[habitId].add(d)
      return next
    })
    if (has) {
      await supabase.from('habit_checks').delete().eq('habit_id', habitId).eq('day', d)
    } else {
      await supabase.from('habit_checks').insert({ habit_id: habitId, day: d })
    }
  }

  // Current run of consecutive checked days ending today (or yesterday)
  function streak(habitId: string): number {
    let s = 0
    let d = today
    if (!checks[habitId]?.has(d)) d = addDays(d, -1)
    while (checks[habitId]?.has(d) && s < 7) { s++; d = addDays(d, -1) }
    return s
  }

  // ── Todos ─────────────────────────────────────────────────────────────────

  async function addTodo() {
    const title = newTodo.trim()
    if (!title) return
    const { data, error } = await supabase
      .from('daily_todos')
      .insert({ day, title })
      .select('id, day, title, done')
      .single()
    if (error) { setDbError('Запусти міграцію daily_migration.sql'); return }
    if (data) setTodos(prev => [...prev, data as Todo])
    setNewTodo('')
  }

  async function toggleTodo(t: Todo) {
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, done: !t.done } : x))
    await supabase.from('daily_todos').update({ done: !t.done }).eq('id', t.id)
  }

  async function deleteTodo(id: string) {
    setTodos(prev => prev.filter(t => t.id !== id))
    await supabase.from('daily_todos').delete().eq('id', id)
  }

  // ── Notes (debounced autosave) ────────────────────────────────────────────

  function onNotesChange(v: string) {
    setNotes(v)
    setNotesSaved(false)
    const forDay = noteDay
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      await supabase
        .from('personal_notes')
        .upsert({ id: forDay, content: v, updated_at: new Date().toISOString() })
      setNotesSaved(true)
      loadRecentNotes()
    }, 800)
  }

  // ── Habit mini-calendar helpers ───────────────────────────────────────────

  function shiftMonth(ym: string, n: number): string {
    const d = new Date(ym + '-15T12:00:00')
    d.setMonth(d.getMonth() + n)
    return isoDay(d).slice(0, 7)
  }

  // 42 cells, Monday-first; null = padding outside the month
  function monthCells(ym: string): (string | null)[] {
    const first = new Date(ym + '-01T12:00:00')
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const lead = (first.getDay() + 6) % 7 // Monday = 0
    const cells: (string | null)[] = Array(lead).fill(null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${ym}-${String(d).padStart(2, '0')}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }

  const doneCount = todos.filter(t => t.done).length
  const dayLabel = day === today
    ? 'Сьогодні'
    : new Date(day + 'T12:00:00').toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Мій день</h1>
        <p className="text-xs text-gray-400 mt-1">Звички, таски на день і нотатки — особисте, бачиш тільки ти.</p>
      </div>

      {dbError && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3">{dbError}</div>
      )}

      <div className="grid gap-6 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {/* ── Habits ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5" style={{ gridColumn: '1 / -1' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Звички</h2>
            <button
              onClick={() => setAddingHabit(true)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              <Plus size={13} /> Додати
            </button>
          </div>

          {addingHabit && (
            <div className="flex items-center gap-2 mb-4">
              <input
                autoFocus
                value={newHabit}
                onChange={e => setNewHabit(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addHabit()
                  if (e.key === 'Escape') { setAddingHabit(false); setNewHabit('') }
                }}
                placeholder="Назва звички..."
                className="flex-1 max-w-xs border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              />
              <button
                onClick={addHabit}
                disabled={!newHabit.trim()}
                className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-3.5 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                Додати
              </button>
            </div>
          )}

          {habits.length === 0 && !addingHabit ? (
            <p className="text-xs text-gray-300 py-4">Додай першу звичку — і трекай щодня 💪</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left font-normal"></th>
                    {weekDays.map(d => (
                      <th key={d} className="pb-2 px-1 text-center w-12">
                        <p className={`text-[10px] font-semibold uppercase ${d === today ? 'text-teal-600' : 'text-gray-400'}`}>
                          {WEEKDAY[new Date(d + 'T12:00:00').getDay()]}
                        </p>
                        <p className={`text-[10px] ${d === today ? 'text-teal-600 font-bold' : 'text-gray-300'}`}>
                          {Number(d.slice(8))}
                        </p>
                      </th>
                    ))}
                    <th className="w-14"></th>
                  </tr>
                </thead>
                <tbody>
                  {habits.map(h => {
                    const s = streak(h.id)
                    const isOpen = expandedHabit === h.id
                    return (
                      <React.Fragment key={h.id}>
                      <tr className="group">
                        <td className="py-1.5 pr-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
                            <span className="text-sm text-gray-800 truncate">{h.name}</span>
                            <button
                              onClick={() => {
                                setExpandedHabit(isOpen ? null : h.id)
                                setCalMonth(today.slice(0, 7))
                              }}
                              className={`transition-all flex-shrink-0 ${
                                isOpen ? 'text-teal-500' : 'opacity-0 group-hover:opacity-100 text-gray-300 hover:text-teal-500'
                              }`}
                              title="Календар звички"
                            >
                              <CalendarDays size={12} />
                            </button>
                            <button
                              onClick={() => deleteHabit(h.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                              title="Видалити звичку"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                        {weekDays.map(d => {
                          const on = checks[h.id]?.has(d)
                          return (
                            <td key={d} className="py-1.5 px-1 text-center">
                              <button
                                onClick={() => toggleCheck(h.id, d)}
                                className="w-7 h-7 rounded-lg border-2 inline-flex items-center justify-center transition-all"
                                style={on
                                  ? { backgroundColor: h.color, borderColor: h.color }
                                  : { borderColor: '#e5e7eb', backgroundColor: 'transparent' }}
                                title={d}
                              >
                                {on && <Check size={14} className="text-white" strokeWidth={3} />}
                              </button>
                            </td>
                          )
                        })}
                        <td className="py-1.5 pl-2">
                          {s >= 2 && (
                            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-orange-500" title="Днів поспіль">
                              <Flame size={11} /> {s}
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded mini month calendar for this habit */}
                      {isOpen && (
                        <tr>
                          <td colSpan={9} className="pb-3">
                            <div className="mt-1 bg-gray-50 rounded-xl p-3 inline-block">
                              <div className="flex items-center justify-between mb-2 gap-4">
                                <button onClick={() => setCalMonth(shiftMonth(calMonth, -1))} className="text-gray-300 hover:text-gray-600 p-0.5 rounded">
                                  <ChevronLeft size={13} />
                                </button>
                                <p className="text-xs font-semibold text-gray-700 capitalize">
                                  {new Date(calMonth + '-15T12:00:00').toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}
                                </p>
                                <button
                                  onClick={() => setCalMonth(shiftMonth(calMonth, 1))}
                                  disabled={calMonth >= today.slice(0, 7)}
                                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 p-0.5 rounded"
                                >
                                  <ChevronRight size={13} />
                                </button>
                              </div>
                              <div className="grid grid-cols-7 gap-1 mb-1">
                                {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map(w => (
                                  <span key={w} className="w-7 text-center text-[9px] text-gray-400 uppercase font-semibold">{w}</span>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-1">
                                {monthCells(calMonth).map((d, i) => {
                                  if (!d) return <span key={i} className="w-7 h-7" />
                                  const on = checks[h.id]?.has(d)
                                  const future = d > today
                                  return (
                                    <button
                                      key={d}
                                      onClick={() => !future && toggleCheck(h.id, d)}
                                      disabled={future}
                                      className={`w-7 h-7 rounded-lg text-[10px] font-medium inline-flex items-center justify-center transition-all ${
                                        future ? 'text-gray-200 cursor-default' : on ? 'text-white' : 'text-gray-500 hover:bg-gray-200 bg-white border border-gray-200'
                                      } ${d === today && !on ? 'ring-1 ring-teal-400' : ''}`}
                                      style={on ? { backgroundColor: h.color } : undefined}
                                      title={d}
                                    >
                                      {Number(d.slice(8))}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Day to-dos ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Таски на день</h2>
            <div className="flex items-center gap-1">
              <button onClick={() => setDay(addDays(day, -1))} className="text-gray-300 hover:text-gray-600 p-1 rounded transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setDay(today)}
                className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                  day === today ? 'text-teal-600 bg-teal-50' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {dayLabel}
              </button>
              <button
                onClick={() => setDay(addDays(day, 1))}
                disabled={day >= today}
                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 p-1 rounded transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              value={newTodo}
              onChange={e => setNewTodo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
              placeholder="Що треба зробити..."
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <button
              onClick={addTodo}
              disabled={!newTodo.trim()}
              className="bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white p-2 rounded-xl transition-colors"
            >
              <Plus size={15} />
            </button>
          </div>

          {todos.length > 0 && (
            <p className="text-[11px] text-gray-400 mb-2">{doneCount} з {todos.length} виконано</p>
          )}

          <div className="flex flex-col gap-1">
            {todos.length === 0 && (
              <p className="text-xs text-gray-300 py-4 text-center">Поки що порожньо</p>
            )}
            {todos.map(t => (
              <div key={t.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
                <button
                  onClick={() => toggleTodo(t)}
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    t.done ? 'bg-teal-500 border-teal-500' : 'border-gray-300 hover:border-teal-400'
                  }`}
                >
                  {t.done && <Check size={12} className="text-white" strokeWidth={3} />}
                </button>
                <span className={`flex-1 text-sm min-w-0 break-words ${t.done ? 'text-gray-300 line-through' : 'text-gray-800'}`}>
                  {t.title}
                </span>
                <button
                  onClick={() => deleteTodo(t.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Daily journal ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <NotebookPen size={14} className="text-amber-500" /> Нотатки
            </h2>
            <div className="flex items-center gap-1">
              <span className={`text-[10px] mr-2 ${notesSaved ? 'text-gray-300' : 'text-amber-500'}`}>
                {notesSaved ? 'збережено' : 'зберігаю...'}
              </span>
              <button onClick={() => setNoteDay(addDays(noteDay, -1))} className="text-gray-300 hover:text-gray-600 p-1 rounded transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setNoteDay(today)}
                className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                  noteDay === today ? 'text-teal-600 bg-teal-50' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {noteDay === today
                  ? 'Сьогодні'
                  : new Date(noteDay + 'T12:00:00').toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
              <button
                onClick={() => setNoteDay(addDays(noteDay, 1))}
                disabled={noteDay >= today}
                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 p-1 rounded transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Days that already have an entry — flip straight to them */}
          {recentNotes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {recentNotes.slice(0, 10).map(d => (
                <button
                  key={d}
                  onClick={() => setNoteDay(d)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                    d === noteDay
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-amber-50 hover:text-amber-600'
                  }`}
                >
                  {d === today ? 'сьогодні' : new Date(d + 'T12:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder={noteDay === today ? 'Думки, ідеї, все що завгодно...' : 'Цього дня записів не було'}
            rows={12}
            className="flex-1 w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y leading-relaxed bg-white"
          />
        </div>
      </div>
    </div>
  )
}
