'use client'

import { useState, useEffect, useMemo, useRef } from 'react'

const ROW_HEIGHT = 40
const SIDEBAR_WIDTH = 230
const DAYS_BEFORE_TODAY = 14
const DAYS_AFTER_TODAY = 45
const MAX_DAYS = 540

interface GanttTask {
  id: string
  title: string
  start_date: string | null
  due_date: string | null
  priority: string | null
}

export interface GanttPhase {
  id: string
  title: string
  start_date: string | null
  end_date: string | null
  done: boolean
}

type DatePatch = { start_date?: string | null; due_date?: string | null }

interface Row {
  key: string
  kind: 'task' | 'phase'
  id: string
  title: string
  start: string | null
  end: string | null
  priority: string | null
  done: boolean
}

interface DragState {
  key: string
  kind: 'task' | 'phase'
  id: string
  type: 'start' | 'end' | 'move'
  startX: number
  origStart: string | null
  origEnd: string | null
  currentStart: string | null
  currentEnd: string | null
  // true when the row had no dates in the DB — commit both dates on drop
  forceBoth: boolean
}

interface Props {
  tasks: GanttTask[]
  onUpdate: (taskId: string, patch: DatePatch) => void
  readOnly?: boolean
  // Roadmap phases, drawn above the tasks
  phases?: GanttPhase[]
  onPhaseUpdate?: (phaseId: string, patch: { start_date?: string | null; end_date?: string | null }) => void
  projectStart?: string | null
  deadline?: string | null
  doneIds?: Set<string>
  onOpenTask?: (taskId: string) => void
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  return new Date(s.slice(0, 10) + 'T00:00:00')
}

const PRIORITY_COLOR: Record<string, string> = { low: '#9CA3AF', medium: '#F59E0B', high: '#EF4444' }

export default function GanttView({
  tasks, onUpdate, readOnly = false, phases, onPhaseUpdate, projectStart, deadline, doneIds, onOpenTask,
}: Props) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayStr = toDateStr(today)
  const [zoom, setZoom] = useState<'day' | 'week'>('day')
  const dayWidth = zoom === 'day' ? 36 : 13

  const baseRows = useMemo<Row[]>(() => [
    ...(phases ?? []).map(p => ({
      key: `p:${p.id}`, kind: 'phase' as const, id: p.id, title: p.title,
      start: p.start_date, end: p.end_date, priority: null, done: p.done,
    })),
    ...tasks.map(t => ({
      key: `t:${t.id}`, kind: 'task' as const, id: t.id, title: t.title,
      start: t.start_date, end: t.due_date, priority: t.priority, done: doneIds?.has(t.id) ?? false,
    })),
  ], [tasks, phases, doneIds])

  const [rows, setRows] = useState<Row[]>(baseRows)
  useEffect(() => { setRows(baseRows) }, [baseRows])

  // The visible range covers the whole programme. It follows the saved
  // dates, not the bar being dragged, so the grid stays still under a drag.
  const { startDate, totalDays } = useMemo(() => {
    const points = [projectStart, deadline, ...baseRows.flatMap(r => [r.start, r.end])]
      .map(parseDate)
      .filter((d): d is Date => !!d)
    let min = addDays(today, -DAYS_BEFORE_TODAY)
    let max = addDays(today, DAYS_AFTER_TODAY)
    for (const d of points) {
      if (addDays(d, -7) < min) min = addDays(d, -7)
      if (addDays(d, 14) > max) max = addDays(d, 14)
    }
    return { startDate: min, totalDays: Math.min(MAX_DAYS, diffDays(min, max) + 1) }
  }, [baseRows, projectStart, deadline, today])

  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(startDate, i)), [startDate, totalDays])
  const offsetOf = (s: string | null | undefined) => {
    const d = parseDate(s)
    return d ? diffDays(startDate, d) * dayWidth : null
  }

  const dragRef = useRef<DragState | null>(null)
  const dayWidthRef = useRef(dayWidth)
  const handlersRef = useRef({ onUpdate, onPhaseUpdate })
  useEffect(() => { dayWidthRef.current = dayWidth }, [dayWidth])
  useEffect(() => { handlersRef.current = { onUpdate, onPhaseUpdate } }, [onUpdate, onPhaseUpdate])

  function handleMouseDown(e: React.MouseEvent, row: Row, type: DragState['type'], effStart: string, effEnd: string, forceBoth: boolean) {
    if (readOnly || (row.kind === 'phase' && !onPhaseUpdate)) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      key: row.key, kind: row.kind, id: row.id, type, startX: e.clientX,
      origStart: effStart, origEnd: effEnd, currentStart: effStart, currentEnd: effEnd, forceBoth,
    }
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const dayDelta = Math.round((e.clientX - drag.startX) / dayWidthRef.current)
      const s = parseDate(drag.origStart)
      const en = parseDate(drag.origEnd)
      let newStart = drag.origStart
      let newEnd = drag.origEnd

      if (drag.type === 'start' && s) {
        const candidate = addDays(s, dayDelta)
        if (!en || candidate <= en) newStart = toDateStr(candidate)
      } else if (drag.type === 'end' && en) {
        const candidate = addDays(en, dayDelta)
        if (!s || candidate >= s) newEnd = toDateStr(candidate)
      } else if (drag.type === 'move') {
        if (s) newStart = toDateStr(addDays(s, dayDelta))
        if (en) newEnd = toDateStr(addDays(en, dayDelta))
      }
      drag.currentStart = newStart
      drag.currentEnd = newEnd
      setRows(prev => prev.map(r => (r.key === drag.key ? { ...r, start: newStart, end: newEnd } : r)))
    }

    function onMouseUp() {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const startChanged = drag.forceBoth || drag.currentStart !== drag.origStart
      const endChanged = drag.forceBoth || drag.currentEnd !== drag.origEnd
      if (!startChanged && !endChanged) return
      if (drag.kind === 'task') {
        handlersRef.current.onUpdate(drag.id, {
          ...(startChanged ? { start_date: drag.currentStart } : {}),
          ...(endChanged ? { due_date: drag.currentEnd } : {}),
        })
      } else {
        handlersRef.current.onPhaseUpdate?.(drag.id, {
          ...(startChanged ? { start_date: drag.currentStart } : {}),
          ...(endChanged ? { end_date: drag.currentEnd } : {}),
        })
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Open on today rather than at the start of the range
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayOffset = diffDays(startDate, today) * dayWidth
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayOffset - 160)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, totalDays])

  const totalWidth = totalDays * dayWidth
  const startOffset = offsetOf(projectStart)
  const deadlineOffset = offsetOf(deadline)
  const canDrag = (r: Row) => !readOnly && (r.kind === 'task' || !!onPhaseUpdate)

  return (
    <div className="flex flex-col h-full select-none">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['day', 'week'] as const).map(z => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${zoom === z ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {z === 'day' ? 'Дні' : 'Тижні'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap">
          {(phases?.length ?? 0) > 0 && <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> етап</span>}
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-teal-500 inline-block" /> у роботі</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> готово</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> прострочено</span>
          {deadline && <span className="flex items-center gap-1"><i className="w-0.5 h-3 bg-red-500 inline-block" /> дедлайн</span>}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ width: SIDEBAR_WIDTH + totalWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 z-30 bg-gray-50 border-b border-gray-100" style={{ height: ROW_HEIGHT }}>
            <div
              className="sticky left-0 z-40 bg-gray-50 border-r border-gray-100 flex items-center px-4 flex-shrink-0"
              style={{ width: SIDEBAR_WIDTH }}
            >
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Етап / задача</span>
            </div>
            {days.map((day, i) => {
              const isToday = toDateStr(day) === todayStr
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const monday = day.getDay() === 1
              const showMonth = i === 0 || day.getDate() === 1 || (zoom === 'day' && monday)
              const showNum = zoom === 'day' || monday
              return (
                <div
                  key={i}
                  className={`flex-shrink-0 flex flex-col items-center justify-center relative ${zoom === 'day' || monday ? 'border-l border-gray-100' : ''} ${isToday ? 'bg-teal-50' : isWeekend ? 'bg-gray-100/60' : ''}`}
                  style={{ width: dayWidth, height: ROW_HEIGHT }}
                >
                  {showMonth && (i === 0 || day.getDate() === 1 || zoom === 'day') && (
                    <span className="text-[9px] text-gray-400 leading-none mb-0.5 whitespace-nowrap">
                      {day.toLocaleDateString('uk-UA', { month: 'short' })}
                    </span>
                  )}
                  {showNum && (
                    <span className={`text-[11px] font-medium whitespace-nowrap ${isToday ? 'text-teal-600 font-bold' : 'text-gray-500'}`}>
                      {day.getDate()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Grid backdrop: weekends and the vertical markers, drawn once */}
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: SIDEBAR_WIDTH, width: totalWidth }}>
              {days.map((day, i) => (day.getDay() === 0 || day.getDay() === 6) && (
                <div key={i} className="absolute top-0 bottom-0 bg-gray-50" style={{ left: i * dayWidth, width: dayWidth }} />
              ))}
              {startOffset !== null && (
                <div className="absolute top-0 bottom-0 border-l border-dashed border-gray-300" style={{ left: startOffset }} />
              )}
              <div className="absolute top-0 bottom-0 w-px bg-teal-400 z-10" style={{ left: todayOffset + dayWidth / 2 }} />
              {deadlineOffset !== null && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: deadlineOffset + dayWidth }} />
              )}
            </div>

            {rows.length === 0 && (
              <p className="text-sm text-gray-400 px-4 py-10 sticky left-0" style={{ width: 420 }}>
                Поки немає ні етапів, ні задач — додай їх, і вони зʼявляться на графіку.
              </p>
            )}

            {rows.map(row => {
              // Rows without dates get a 1-day placeholder at today —
              // dragging it commits real dates
              const effStart = row.start ?? row.end ?? todayStr
              const effEnd = row.end ?? row.start ?? todayStr
              const isPlaceholder = !row.start || !row.end
              const left = offsetOf(effStart) ?? 0
              const width = Math.max(dayWidth, (offsetOf(effEnd) ?? 0) - left + dayWidth)
              const overdue = !row.done && !!row.end && row.end.slice(0, 10) < todayStr
              const isPhase = row.kind === 'phase'
              const color = row.done ? 'bg-green-500' : overdue ? 'bg-red-500' : isPhase ? 'bg-violet-500' : 'bg-teal-500'
              const draggable = canDrag(row)

              return (
                <div key={row.key} className={`flex border-b border-gray-50 ${isPhase ? 'bg-violet-50/40' : ''}`} style={{ height: ROW_HEIGHT }}>
                  <div
                    onClick={() => { if (!isPhase) onOpenTask?.(row.id) }}
                    className={`sticky left-0 z-20 border-r border-gray-100 flex items-center gap-2 px-4 flex-shrink-0 ${isPhase ? 'bg-violet-50' : 'bg-white'} ${!isPhase && onOpenTask ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    style={{ width: SIDEBAR_WIDTH }}
                    title={row.title}
                  >
                    {isPhase
                      ? <span className="w-2 h-2 rotate-45 bg-violet-500 flex-shrink-0" />
                      : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_COLOR[row.priority ?? 'medium'] ?? '#9CA3AF' }} />}
                    <span className={`text-xs truncate ${isPhase ? 'font-semibold text-gray-900' : row.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      {row.title}
                    </span>
                  </div>

                  <div className="relative flex-shrink-0" style={{ width: totalWidth }}>
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 rounded-md flex items-center overflow-hidden z-10 ${color} ${
                        isPlaceholder ? 'opacity-50 border-2 border-dashed border-white/70' : ''
                      }`}
                      style={{ left, width, height: isPhase ? 22 : 26 }}
                      title={`${row.title}${row.start ? ` · ${row.start.slice(0, 10)}` : ''}${row.end ? ` → ${row.end.slice(0, 10)}` : ''}`}
                    >
                      {draggable && (
                        <div
                          className="w-2.5 h-full flex-shrink-0 cursor-ew-resize hover:bg-white/25"
                          onMouseDown={e => handleMouseDown(e, row, 'start', effStart, effEnd, isPlaceholder)}
                        />
                      )}
                      <div
                        className={`flex-1 px-1 overflow-hidden ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        onMouseDown={e => handleMouseDown(e, row, 'move', effStart, effEnd, isPlaceholder)}
                      >
                        <span className="text-[11px] text-white font-medium whitespace-nowrap">{row.title}</span>
                      </div>
                      {draggable && (
                        <div
                          className="w-2.5 h-full flex-shrink-0 cursor-ew-resize hover:bg-white/25"
                          onMouseDown={e => handleMouseDown(e, row, 'end', effStart, effEnd, isPlaceholder)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
