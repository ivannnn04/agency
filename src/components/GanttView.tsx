'use client'

import { useState, useEffect, useRef } from 'react'

const DAY_WIDTH = 40
const ROW_HEIGHT = 44
const SIDEBAR_WIDTH = 220
const TOTAL_DAYS = 90
const DAYS_BEFORE_TODAY = 14

interface GanttTask {
  id: string
  title: string
  start_date: string | null
  due_date: string | null
  priority: string | null
}

interface DragState {
  taskId: string
  type: 'start' | 'end' | 'move'
  startX: number
  origStart: string | null
  origEnd: string | null
  currentStart: string | null
  currentEnd: string | null
}

interface Props {
  tasks: GanttTask[]
  onUpdate: (taskId: string, patch: { start_date?: string | null; due_date?: string | null }) => void
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function parseDate(s: string | null): Date | null {
  if (!s) return null
  return new Date(s + 'T00:00:00')
}

export default function GanttView({ tasks, onUpdate }: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startDate = addDays(today, -DAYS_BEFORE_TODAY)

  const [localTasks, setLocalTasks] = useState<GanttTask[]>(tasks)
  const dragRef = useRef<DragState | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const localTasksRef = useRef<GanttTask[]>(tasks)

  useEffect(() => { onUpdateRef.current = onUpdate }, [onUpdate])
  useEffect(() => { setLocalTasks(tasks); localTasksRef.current = tasks }, [tasks])

  // Build day headers
  const days: Date[] = []
  for (let i = 0; i < TOTAL_DAYS; i++) {
    days.push(addDays(startDate, i))
  }

  function dateToOffset(dateStr: string | null): number | null {
    if (!dateStr) return null
    const d = parseDate(dateStr)
    if (!d) return null
    return diffDays(startDate, d) * DAY_WIDTH
  }

  function offsetToDateStr(px: number): string {
    const dayIndex = Math.round(px / DAY_WIDTH)
    return toDateStr(addDays(startDate, dayIndex))
  }

  function clampOffset(px: number): number {
    return Math.max(0, Math.min(px, (TOTAL_DAYS - 1) * DAY_WIDTH))
  }

  function handleMouseDown(
    e: React.MouseEvent,
    taskId: string,
    type: 'start' | 'end' | 'move',
    origStart: string | null,
    origEnd: string | null,
  ) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      taskId, type,
      startX: e.clientX,
      origStart, origEnd,
      currentStart: origStart,
      currentEnd: origEnd,
    }
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return

      const dx = e.clientX - drag.startX
      const dayDelta = Math.round(dx / DAY_WIDTH)

      let newStart = drag.origStart
      let newEnd = drag.origEnd

      if (drag.type === 'start') {
        const origStartDate = parseDate(drag.origStart)
        if (origStartDate) {
          const candidate = addDays(origStartDate, dayDelta)
          const endDate = parseDate(drag.origEnd)
          // Prevent crossing end date
          if (!endDate || candidate <= endDate) {
            newStart = toDateStr(candidate)
          }
        }
      } else if (drag.type === 'end') {
        const origEndDate = parseDate(drag.origEnd)
        if (origEndDate) {
          const candidate = addDays(origEndDate, dayDelta)
          const startDt = parseDate(drag.origStart)
          if (!startDt || candidate >= startDt) {
            newEnd = toDateStr(candidate)
          }
        }
      } else {
        // move: shift both
        const origStartDate = parseDate(drag.origStart)
        const origEndDate = parseDate(drag.origEnd)
        if (origStartDate) newStart = toDateStr(addDays(origStartDate, dayDelta))
        if (origEndDate) newEnd = toDateStr(addDays(origEndDate, dayDelta))
      }

      if (dragRef.current) {
        dragRef.current.currentStart = newStart
        dragRef.current.currentEnd = newEnd
      }

      setLocalTasks(prev =>
        prev.map(t =>
          t.id === drag.taskId ? { ...t, start_date: newStart, due_date: newEnd } : t
        )
      )
    }

    function onMouseUp() {
      const drag = dragRef.current
      if (!drag) return

      const patch: { start_date?: string | null; due_date?: string | null } = {}
      if (drag.currentStart !== drag.origStart) patch.start_date = drag.currentStart
      if (drag.currentEnd !== drag.origEnd) patch.due_date = drag.currentEnd

      if (Object.keys(patch).length > 0) {
        onUpdateRef.current(drag.taskId, patch)
      }
      dragRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const todayOffset = diffDays(startDate, today) * DAY_WIDTH
  const totalWidth = TOTAL_DAYS * DAY_WIDTH

  const PRIORITY_COLOR: Record<string, string> = {
    low: '#9CA3AF',
    medium: '#F59E0B',
    high: '#EF4444',
  }

  return (
    <div className="flex h-full overflow-hidden select-none">
      {/* Left sidebar */}
      <div
        className="flex-shrink-0 bg-white border-r border-gray-100 z-10"
        style={{ width: SIDEBAR_WIDTH }}
      >
        {/* Header placeholder */}
        <div
          className="border-b border-gray-100 bg-gray-50"
          style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', paddingLeft: 16 }}
        >
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Задача</span>
        </div>
        {localTasks.map(task => (
          <div
            key={task.id}
            className="flex items-center gap-2 px-4 border-b border-gray-50"
            style={{ height: ROW_HEIGHT }}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: PRIORITY_COLOR[task.priority ?? 'medium'] ?? '#9CA3AF' }}
            />
            <span className="text-xs text-gray-700 truncate">{task.title}</span>
          </div>
        ))}
      </div>

      {/* Right: scrollable timeline */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* Day header row */}
          <div
            className="flex border-b border-gray-100 bg-gray-50 sticky top-0 z-10"
            style={{ height: ROW_HEIGHT }}
          >
            {days.map((day, i) => {
              const isToday = diffDays(today, day) === 0
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const showMonth = i === 0 || day.getDate() === 1 || i % 7 === 0

              return (
                <div
                  key={i}
                  className={`flex-shrink-0 flex flex-col items-center justify-center border-r border-gray-100 relative ${isToday ? 'bg-teal-50' : isWeekend ? 'bg-gray-100/60' : ''}`}
                  style={{ width: DAY_WIDTH, height: ROW_HEIGHT }}
                >
                  {showMonth && (
                    <span className="text-[9px] text-gray-400 leading-none mb-0.5">
                      {day.toLocaleDateString('uk-UA', { month: 'short' })}
                    </span>
                  )}
                  <span
                    className={`text-[11px] font-medium ${isToday ? 'text-teal-600 font-bold' : 'text-gray-500'}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Task rows */}
          <div style={{ position: 'relative' }}>
            {/* Today line */}
            {todayOffset >= 0 && todayOffset <= totalWidth && (
              <div
                className="absolute top-0 bottom-0 w-px bg-teal-400 z-20 pointer-events-none"
                style={{ left: todayOffset + DAY_WIDTH / 2 }}
              />
            )}

            {localTasks.map(task => {
              const startOff = dateToOffset(task.start_date)
              const endOff = dateToOffset(task.due_date)
              const hasBar = startOff !== null && endOff !== null
              const hasDiamond = startOff === null && endOff !== null

              // Bar width: at least 1 day
              const barLeft = hasBar ? startOff! : 0
              const barWidth = hasBar ? Math.max(DAY_WIDTH, endOff! - startOff! + DAY_WIDTH) : 0

              return (
                <div
                  key={task.id}
                  className="relative border-b border-gray-50"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Weekend shading */}
                  {days.map((day, i) => {
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6
                    if (!isWeekend) return null
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 bg-gray-50/80 pointer-events-none"
                        style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                      />
                    )
                  })}

                  {hasBar && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 rounded-md bg-teal-500 flex items-center overflow-hidden group z-10"
                      style={{ left: barLeft, width: barWidth, height: 28 }}
                    >
                      {/* Left drag handle */}
                      <div
                        className="w-3 h-full flex-shrink-0 cursor-ew-resize hover:bg-teal-400 flex items-center justify-center"
                        onMouseDown={e =>
                          handleMouseDown(e, task.id, 'start', task.start_date, task.due_date)
                        }
                      >
                        <div className="w-0.5 h-3 bg-teal-300 rounded-full" />
                      </div>

                      {/* Middle: title + move */}
                      <div
                        className="flex-1 px-1 overflow-hidden cursor-grab active:cursor-grabbing"
                        onMouseDown={e =>
                          handleMouseDown(e, task.id, 'move', task.start_date, task.due_date)
                        }
                      >
                        <span className="text-[11px] text-white font-medium whitespace-nowrap">
                          {task.title}
                        </span>
                      </div>

                      {/* Right drag handle */}
                      <div
                        className="w-3 h-full flex-shrink-0 cursor-ew-resize hover:bg-teal-400 flex items-center justify-center"
                        onMouseDown={e =>
                          handleMouseDown(e, task.id, 'end', task.start_date, task.due_date)
                        }
                      >
                        <div className="w-0.5 h-3 bg-teal-300 rounded-full" />
                      </div>
                    </div>
                  )}

                  {hasDiamond && (
                    <div
                      className="absolute top-1/2 z-10 pointer-events-none"
                      style={{
                        left: endOff! + DAY_WIDTH / 2 - 8,
                        transform: 'translateY(-50%)',
                      }}
                    >
                      <div
                        className="w-4 h-4 bg-amber-400 rotate-45"
                        title={task.title}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
