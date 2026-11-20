'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CalendarRange, ChevronDown, ChevronRight, Flag, Plus, Trash2 } from 'lucide-react'
import GanttView, { GanttPhase } from '@/components/GanttView'

// The project's programme: overall start and deadline, the roadmap as
// phases, and every board task on one Gantt chart.

interface ProgramTask { id: string; title: string; start_date: string | null; due_date: string | null; priority: string | null }

const dayNum = (iso: string) => Math.floor(new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime() / 86_400_000)
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProjectProgram({
  projectId, startDate, deadline, tasks, doneIds, readOnly = false, onProjectDates, onTaskDates, onOpenTask,
}: {
  projectId: string
  startDate: string | null
  deadline: string | null
  tasks: ProgramTask[]
  doneIds: Set<string>
  readOnly?: boolean
  onProjectDates: (patch: { start_date?: string | null; deadline?: string | null }) => void
  onTaskDates: (taskId: string, patch: { start_date?: string | null; due_date?: string | null }) => void
  onOpenTask?: (taskId: string) => void
}) {
  const [phases, setPhases] = useState<GanttPhase[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    supabase
      .from('project_milestones')
      .select('id, title, start_date, end_date, done, position')
      .eq('project_id', projectId)
      .order('position')
      .then(({ data, error: e }) => {
        if (e) setError('Щоб планувати дати проєкту й роадмап, запусти міграцію supabase/project_program_migration.sql у Supabase SQL Editor.')
        else setPhases((data ?? []) as GanttPhase[])
      })
  }, [projectId])

  async function addPhase() {
    const last = phases[phases.length - 1]
    const start = last?.end_date ?? startDate ?? todayIso()
    const end = new Date((dayNum(start) + 14) * 86_400_000).toISOString().slice(0, 10)
    const { data, error: e } = await supabase
      .from('project_milestones')
      .insert({ project_id: projectId, title: `Етап ${phases.length + 1}`, start_date: start, end_date: end, position: phases.length })
      .select('id, title, start_date, end_date, done')
      .single()
    if (e) setError(e.message)
    else if (data) setPhases(prev => [...prev, data as GanttPhase])
  }

  async function updatePhase(id: string, patch: Partial<GanttPhase>) {
    setPhases(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error: e } = await supabase.from('project_milestones').update(patch).eq('id', id)
    if (e) setError(e.message)
  }

  async function deletePhase(id: string) {
    if (!window.confirm('Видалити цей етап роадмапу?')) return
    setPhases(prev => prev.filter(p => p.id !== id))
    await supabase.from('project_milestones').delete().eq('id', id)
  }

  const today = todayIso()
  const left = deadline ? dayNum(deadline) - dayNum(today) : null
  const undated = tasks.filter(t => !doneIds.has(t.id) && (!t.start_date || !t.due_date)).length
  const input = 'text-sm text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <CalendarRange size={13} /> Старт
            <input type="date" disabled={readOnly} value={startDate?.slice(0, 10) ?? ''} onChange={e => onProjectDates({ start_date: e.target.value || null })} className={input} />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <Flag size={13} className="text-red-500" /> Дедлайн
            <input type="date" disabled={readOnly} value={deadline?.slice(0, 10) ?? ''} onChange={e => onProjectDates({ deadline: e.target.value || null })} className={input} />
          </label>
          {left !== null && (
            <span className={`text-xs font-medium px-2 py-1 rounded-md ${left < 0 ? 'bg-red-50 text-red-600' : left <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
              {left < 0 ? `дедлайн минув ${-left} дн тому` : left === 0 ? 'дедлайн сьогодні' : `до дедлайну ${left} дн`}
            </span>
          )}
          <span className="text-xs text-gray-400">
            готово {doneIds.size} з {tasks.length} задач{undated > 0 ? ` · ${undated} без дат` : ''}
          </span>
          <button onClick={() => setOpen(v => !v)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-gray-700">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Роадмап · {phases.length}
          </button>
        </div>
        {error && <p className="px-4 pb-2 text-xs text-amber-700">{error}</p>}

        {open && !error && (
          <div className="px-4 pb-3 flex flex-col gap-1.5">
            {phases.map(p => (
              <div key={p.id} className="flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox" checked={p.done} disabled={readOnly}
                  onChange={e => updatePhase(p.id, { done: e.target.checked })}
                  title="Етап завершено" className="accent-green-600"
                />
                <input
                  value={p.title} disabled={readOnly}
                  onChange={e => setPhases(prev => prev.map(x => (x.id === p.id ? { ...x, title: e.target.value } : x)))}
                  onBlur={e => updatePhase(p.id, { title: e.target.value.trim() || 'Етап' })}
                  className={`${input} flex-1 min-w-40 ${p.done ? 'line-through text-gray-400' : ''}`}
                />
                <input type="date" disabled={readOnly} value={p.start_date?.slice(0, 10) ?? ''} onChange={e => updatePhase(p.id, { start_date: e.target.value || null })} className={input} />
                <span className="text-gray-300 text-xs">→</span>
                <input type="date" disabled={readOnly} value={p.end_date?.slice(0, 10) ?? ''} onChange={e => updatePhase(p.id, { end_date: e.target.value || null })} className={input} />
                {!readOnly && (
                  <button onClick={() => deletePhase(p.id)} className="text-gray-300 hover:text-red-400 p-1"><Trash2 size={13} /></button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button onClick={addPhase} className="self-start flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 mt-0.5">
                <Plus size={12} /> Додати етап
              </button>
            )}
            {phases.length === 0 && (
              <p className="text-xs text-gray-400">
                Роадмап — це великі етапи проєкту (дослідження, вайрфрейми, UI, розробка…). Додай їх, і вони зʼявляться на графіку над задачами.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <GanttView
          tasks={tasks}
          onUpdate={onTaskDates}
          readOnly={readOnly}
          phases={phases}
          onPhaseUpdate={readOnly ? undefined : (id, patch) => updatePhase(id, patch)}
          projectStart={startDate}
          deadline={deadline}
          doneIds={doneIds}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  )
}
