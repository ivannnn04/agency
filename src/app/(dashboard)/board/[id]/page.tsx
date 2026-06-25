'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PMProject, PMColumn, PMTask } from '@/types/pm'
import { Plus, X, MoreHorizontal, ChevronRight, Trash2, Flag, Calendar } from 'lucide-react'

const DEFAULT_COLUMNS = [
  { name: 'To Do',       color: '#6B7280', position: 0 },
  { name: 'In Progress', color: '#3b82f6', position: 1 },
  { name: 'Review',      color: '#f59e0b', position: 2 },
  { name: 'Done',        color: '#10b981', position: 3 },
]

const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-amber-50 text-amber-600',
  high:   'bg-red-50 text-red-500',
}
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низький', medium: 'Середній', high: 'Високий',
}

export default function BoardPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<PMProject | null>(null)
  const [columns, setColumns] = useState<PMColumn[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<PMTask | null>(null)
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [newColColor, setNewColColor] = useState('#6B7280')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (id) fetchAll()
  }, [id])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: proj }, { data: cols }, { data: tx }] = await Promise.all([
      supabase.from('pm_projects').select('*').eq('id', id).single(),
      supabase.from('pm_columns').select('*').eq('project_id', id).order('position'),
      supabase.from('pm_tasks').select('*').eq('project_id', id).order('created_at'),
    ])

    if (proj) setProject(proj)

    if (cols && cols.length > 0) {
      setColumns(cols)
    } else {
      // Seed default columns on first open
      const toInsert = DEFAULT_COLUMNS.map(c => ({ ...c, project_id: id }))
      const { data: seeded } = await supabase.from('pm_columns').insert(toInsert).select()
      if (seeded) setColumns(seeded)
    }

    if (tx) setTasks(tx)
    setLoading(false)
  }

  async function addTask(columnId: string) {
    const title = newTaskTitle.trim()
    if (!title) return
    const { data } = await supabase
      .from('pm_tasks')
      .insert({
        project_id: id,
        column_id: columnId,
        title,
        status: 'todo',
        priority: 'medium',
        description: null,
        assignee_id: null,
        due_date: null,
        created_by: 'admin',
      })
      .select()
      .single()
    setNewTaskTitle('')
    setAddingInColumn(null)
    if (data) setTasks(prev => [...prev, data])
  }

  async function moveTask(taskId: string, toColumnId: string) {
    await supabase.from('pm_tasks').update({ column_id: toColumnId }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, column_id: toColumnId } : t))
    setOpenMenu(null)
  }

  async function deleteTask(taskId: string) {
    await supabase.from('pm_tasks').delete().eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    if (selectedTask?.id === taskId) setSelectedTask(null)
    setOpenMenu(null)
  }

  async function addColumn() {
    const name = newColName.trim()
    if (!name) return
    const position = columns.length
    const { data } = await supabase
      .from('pm_columns')
      .insert({ project_id: id, name, color: newColColor, position })
      .select()
      .single()
    setNewColName('')
    setNewColColor('#6B7280')
    setAddingColumn(false)
    if (data) setColumns(prev => [...prev, data])
  }

  async function deleteColumn(colId: string) {
    await supabase.from('pm_tasks').update({ column_id: null }).eq('column_id', colId)
    await supabase.from('pm_columns').delete().eq('id', colId)
    setColumns(prev => prev.filter(c => c.id !== colId))
    setTasks(prev => prev.map(t => t.column_id === colId ? { ...t, column_id: undefined as any } : t))
  }

  async function updateTask(taskId: string, patch: Partial<PMTask>) {
    await supabase.from('pm_tasks').update(patch).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
    if (selectedTask?.id === taskId) setSelectedTask(prev => prev ? { ...prev, ...patch } : prev)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Завантаження...
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full flex flex-col">
          {/* Board header */}
          <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <h1 className="text-lg font-semibold text-gray-900">{project?.name}</h1>
          </div>

          {/* Columns */}
          <div className="flex gap-4 p-6 overflow-x-auto flex-1 items-start">
            {columns.map(col => {
              const colTasks = tasks.filter(t => t.column_id === col.id)
              const isAddingHere = addingInColumn === col.id

              return (
                <div
                  key={col.id}
                  className="flex-shrink-0 w-[280px] flex flex-col bg-gray-50 rounded-xl"
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                      <span className="text-sm font-semibold text-gray-700">{col.name}</span>
                      <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">
                        {colTasks.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setAddingInColumn(col.id); setNewTaskTitle('') }}
                        className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
                        title="Додати задачу"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={() => deleteColumn(col.id)}
                        className="text-gray-400 hover:text-red-400 p-1 rounded transition-colors"
                        title="Видалити колонку"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Tasks */}
                  <div className="flex flex-col gap-2 px-3 pb-3 flex-1 overflow-y-auto max-h-[calc(100vh-220px)]">
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        columns={columns}
                        isMenuOpen={openMenu === task.id}
                        onOpenMenu={() => setOpenMenu(openMenu === task.id ? null : task.id)}
                        onSelect={() => setSelectedTask(task)}
                        onMove={toColId => moveTask(task.id, toColId)}
                        onDelete={() => deleteTask(task.id)}
                        menuRef={openMenu === task.id ? menuRef : undefined}
                      />
                    ))}

                    {isAddingHere && (
                      <div className="bg-white rounded-lg border border-teal-200 p-2.5">
                        <input
                          autoFocus
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') addTask(col.id)
                            if (e.key === 'Escape') { setAddingInColumn(null); setNewTaskTitle('') }
                          }}
                          placeholder="Назва задачі..."
                          className="w-full text-sm text-gray-800 focus:outline-none placeholder-gray-400"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => addTask(col.id)}
                            className="flex-1 text-xs bg-gray-900 text-white rounded-md py-1.5 hover:bg-gray-700 transition-colors"
                          >
                            Додати
                          </button>
                          <button
                            onClick={() => { setAddingInColumn(null); setNewTaskTitle('') }}
                            className="text-xs text-gray-400 hover:text-gray-600 px-2"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    {!isAddingHere && (
                      <button
                        onClick={() => { setAddingInColumn(col.id); setNewTaskTitle('') }}
                        className="w-full flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 py-1.5 px-1 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <Plus size={13} /> Додати задачу
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Add column */}
            <div className="flex-shrink-0 w-[240px]">
              {addingColumn ? (
                <div className="bg-gray-50 rounded-xl p-3">
                  <input
                    autoFocus
                    value={newColName}
                    onChange={e => setNewColName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addColumn()
                      if (e.key === 'Escape') { setAddingColumn(false); setNewColName('') }
                    }}
                    placeholder="Назва колонки..."
                    className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <label className="text-xs text-gray-500">Колір:</label>
                    <input
                      type="color"
                      value={newColColor}
                      onChange={e => setNewColColor(e.target.value)}
                      className="w-8 h-6 rounded cursor-pointer border-0"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={addColumn}
                      className="flex-1 text-xs bg-gray-900 text-white rounded-md py-1.5 hover:bg-gray-700 transition-colors"
                    >
                      Додати
                    </button>
                    <button
                      onClick={() => { setAddingColumn(false); setNewColName('') }}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingColumn(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
                >
                  <Plus size={15} /> Нова колонка
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          columns={columns}
          onClose={() => setSelectedTask(null)}
          onUpdate={patch => updateTask(selectedTask.id, patch)}
          onDelete={() => deleteTask(selectedTask.id)}
          onMove={toColId => moveTask(selectedTask.id, toColId)}
        />
      )}
    </div>
  )
}

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task, columns, isMenuOpen, onOpenMenu, onSelect, onMove, onDelete, menuRef,
}: {
  task: PMTask
  columns: PMColumn[]
  isMenuOpen: boolean
  onOpenMenu: () => void
  onSelect: () => void
  onMove: (colId: string) => void
  onDelete: () => void
  menuRef?: React.RefObject<HTMLDivElement>
}) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()

  return (
    <div
      className="bg-white rounded-lg border border-gray-100 p-3 hover:border-gray-200 hover:shadow-sm transition-all group cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-800 leading-snug flex-1">{task.title}</p>
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={e => { e.stopPropagation(); onOpenMenu() }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 p-0.5 rounded transition-all"
          >
            <MoreHorizontal size={14} />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-6 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[160px]">
              <p className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide font-medium">Перемістити до</p>
              {columns.map(c => (
                <button
                  key={c.id}
                  onClick={e => { e.stopPropagation(); onMove(c.id) }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    task.column_id === c.id ? 'text-teal-600 font-medium' : 'text-gray-700'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  {c.name}
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={e => { e.stopPropagation(); onDelete() }}
                  className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 size={12} /> Видалити
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.priority && task.priority !== 'medium' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        )}
        {task.due_date && (
          <span className={`flex items-center gap-1 text-[10px] ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
            <Calendar size={10} />
            {new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Task detail panel ──────────────────────────────────────────────────────────

function TaskDetailPanel({
  task, columns, onClose, onUpdate, onDelete, onMove,
}: {
  task: PMTask
  columns: PMColumn[]
  onClose: () => void
  onUpdate: (patch: Partial<PMTask>) => void
  onDelete: () => void
  onMove: (colId: string) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc]   = useState(task.description ?? '')

  useEffect(() => {
    setTitle(task.title)
    setDesc(task.description ?? '')
  }, [task.id])

  function saveTitle() {
    const t = title.trim()
    if (t && t !== task.title) onUpdate({ title: t })
  }

  function saveDesc() {
    const d = desc.trim()
    if (d !== (task.description ?? '')) onUpdate({ description: d || null })
  }

  const currentCol = columns.find(c => c.id === task.column_id)

  return (
    <div className="w-[360px] min-w-[360px] border-l border-gray-100 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {currentCol && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: currentCol.color }} />
              {currentCol.name}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDelete} className="text-gray-400 hover:text-red-400 p-1.5 rounded transition-colors">
            <Trash2 size={14} />
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {/* Title */}
        <textarea
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={2}
          className="w-full text-base font-semibold text-gray-900 resize-none focus:outline-none border-b border-transparent focus:border-gray-200 pb-1 leading-snug"
          placeholder="Назва задачі"
        />

        {/* Metadata */}
        <div className="flex flex-col gap-3 text-sm">
          {/* Column */}
          <div className="flex items-center gap-3">
            <span className="text-gray-400 w-24 text-xs">Колонка</span>
            <select
              value={task.column_id ?? ''}
              onChange={e => onMove(e.target.value)}
              className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none"
            >
              {columns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="flex items-center gap-3">
            <span className="text-gray-400 w-24 text-xs">Пріоритет</span>
            <select
              value={task.priority ?? 'medium'}
              onChange={e => onUpdate({ priority: e.target.value as PMTask['priority'] })}
              className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none"
            >
              <option value="low">Низький</option>
              <option value="medium">Середній</option>
              <option value="high">Високий</option>
            </select>
          </div>

          {/* Due date */}
          <div className="flex items-center gap-3">
            <span className="text-gray-400 w-24 text-xs">Дедлайн</span>
            <input
              type="date"
              value={task.due_date ? task.due_date.split('T')[0] : ''}
              onChange={e => onUpdate({ due_date: e.target.value || null })}
              className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Опис</p>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={saveDesc}
            rows={5}
            placeholder="Додати опис..."
            className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-gray-200 placeholder-gray-400"
          />
        </div>
      </div>
    </div>
  )
}
