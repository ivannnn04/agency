'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchAssigneesByTask } from '@/lib/assignees'
import { Project, TeamMember } from '@/types'
import { PMColumn, PMTask } from '@/types/pm'
import {
  Plus, X, MoreHorizontal, Trash2, Calendar, Flag,
  Tag, User, ChevronRight, AlignLeft, CheckSquare, UserPlus,
} from 'lucide-react'
import GanttView from '@/components/GanttView'

const DEFAULT_COLUMNS = [
  { name: 'TO DO',                 color: '#F59E0B', position: 0 },
  { name: 'IN PROGRESS',           color: '#6B7280', position: 1 },
  { name: 'INTERNAL REVIEW',       color: '#F97316', position: 2 },
  { name: 'READY FOR REPORT',      color: '#8B5CF6', position: 3 },
  { name: 'WAITING FOR FEEDBACK',  color: '#EF4444', position: 4 },
  { name: 'READY FOR DEVELOPMENT', color: '#10B981', position: 5 },
  { name: 'BLOCKED',               color: '#EC4899', position: 6 },
  { name: 'TO BE INVOICED',        color: '#6366F1', position: 7 },
]

const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Низький',  color: '#9CA3AF' },
  { value: 'medium', label: 'Середній', color: '#F59E0B' },
  { value: 'high',   label: 'Високий',  color: '#EF4444' },
]

function priorityColor(p: string | null) {
  return PRIORITY_OPTIONS.find(o => o.value === p)?.color ?? '#9CA3AF'
}

function memberInitial(m: TeamMember) {
  return m.name.charAt(0).toUpperCase()
}

// Overlapping stack of assignee avatars (up to `max`, then "+N")
function AvatarStack({ memberIds, members, max = 3 }: {
  memberIds: string[]
  members: TeamMember[]
  max?: number
}) {
  const assigned = memberIds
    .map(mid => members.find(m => m.id === mid))
    .filter((m): m is TeamMember => !!m)
  if (assigned.length === 0) {
    return (
      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
        <User size={10} className="text-gray-400" />
      </div>
    )
  }
  const shown = assigned.slice(0, max)
  const extra = assigned.length - shown.length
  return (
    <div className="flex items-center">
      {shown.map(m => (
        <div
          key={m.id}
          title={m.name}
          className="w-6 h-6 rounded-full ring-2 ring-white -ml-1.5 first:ml-0 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
          style={{ backgroundColor: m.color }}
        >
          {m.name.charAt(0)}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-6 h-6 rounded-full ring-2 ring-white -ml-1.5 bg-gray-400 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
          +{extra}
        </div>
      )}
    </div>
  )
}

export default function BoardPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject]         = useState<Project | null>(null)
  const [columns, setColumns]         = useState<PMColumn[]>([])
  const [tasks, setTasks]             = useState<PMTask[]>([])
  const [assigneesByTask, setAssigneesByTask] = useState<Record<string, string[]>>({})
  const [members, setMembers]         = useState<TeamMember[]>([])
  const [projectMembers, setProjectMembers] = useState<TeamMember[]>([])
  const [memberPanelOpen, setMemberPanelOpen] = useState(false)
  const [loading, setLoading]         = useState(true)
  const [dbError, setDbError]         = useState<string | null>(null)
  const [selectedTask, setSelectedTask]     = useState<PMTask | null>(null)
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [addingColumn, setAddingColumn]     = useState(false)
  const [newColName, setNewColName]   = useState('')
  const [newColColor, setNewColColor] = useState('#6B7280')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [view, setView] = useState<'board' | 'gantt'>('board')
  const menuRef    = useRef<HTMLDivElement>(null)
  const memberRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { if (id) fetchAll() }, [id])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
      if (memberRef.current && !memberRef.current.contains(e.target as Node)) setMemberPanelOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchAll() {
    setLoading(true)
    setDbError(null)
    const [{ data: proj }, { data: cols, error: colErr }, { data: tx }, { data: mems }, { data: pm }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('pm_columns').select('*').eq('project_id', id).order('position'),
      supabase.from('pm_tasks').select('*').eq('finance_project_id', id).order('created_at'),
      supabase.from('team_members').select('*').order('created_at'),
      supabase.from('project_members').select('team_member_id').eq('project_id', id),
    ])
    if (proj) setProject(proj)
    if (mems) {
      setMembers(mems)
      const pmIds = new Set((pm ?? []).map(r => r.team_member_id))
      setProjectMembers(mems.filter(m => pmIds.has(m.id)))
    }

    if (colErr) {
      setDbError('Таблиця pm_columns не знайдена. Запусти SQL міграцію в Supabase.')
      setLoading(false)
      return
    }

    if (cols && cols.length > 0) {
      setColumns(cols)
    } else {
      const { data: seeded, error: seedErr } = await supabase
        .from('pm_columns')
        .insert(DEFAULT_COLUMNS.map(c => ({ ...c, project_id: id })))
        .select()
      if (seedErr) {
        setDbError(`Помилка створення колонок: ${seedErr.message}`)
      } else if (seeded) {
        setColumns(seeded)
      }
    }
    if (tx) {
      setTasks(tx)
      setAssigneesByTask(await fetchAssigneesByTask(tx.map(t => t.id)))
    }
    setLoading(false)
  }

  async function addTask(columnId: string, patch: Partial<PMTask> & { title: string; team_member_ids?: string[] }) {
    const memberIds = patch.team_member_ids ?? []
    const primary = memberIds[0] ?? null
    const { data, error } = await supabase
      .from('pm_tasks')
      .insert({
        finance_project_id: id,
        column_id: columnId,
        title: patch.title,
        status: 'todo',
        priority: patch.priority ?? 'medium',
        team_member_id: primary,
        due_date: patch.due_date ?? null,
        description: null,
      })
      .select()
      .single()
    setAddingInColumn(null)
    if (error) {
      setDbError(`Помилка збереження задачі: ${error.message}`)
    } else if (data) {
      setTasks(prev => [...prev, data])
      if (memberIds.length > 0) {
        await supabase.from('task_assignees').insert(
          memberIds.map(mid => ({ task_id: data.id, team_member_id: mid }))
        )
        setAssigneesByTask(prev => ({ ...prev, [data.id]: memberIds }))
        for (const mid of memberIds) {
          await supabase.from('notifications').insert({
            type: 'task_assigned',
            message: `Вам призначено задачу «${data.title ?? ''}» у проєкті «${project?.name ?? ''}»`,
            project_id: id,
            task_id: data.id,
            team_member_id: mid,
            recipient_team_member_id: mid,
          })
        }
      }
    }
  }

  async function addAssignee(taskId: string, memberId: string) {
    const current = assigneesByTask[taskId] ?? []
    if (current.includes(memberId)) return
    await supabase.from('task_assignees').insert({ task_id: taskId, team_member_id: memberId })
    const next = [...current, memberId]
    setAssigneesByTask(prev => ({ ...prev, [taskId]: next }))
    const primary = next[0] ?? null
    await supabase.from('pm_tasks').update({ team_member_id: primary }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, team_member_id: primary } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, team_member_id: primary } : prev)
    const task = tasks.find(t => t.id === taskId)
    await supabase.from('notifications').insert({
      type: 'task_assigned',
      message: `Вам призначено задачу «${task?.title ?? ''}» у проєкті «${project?.name ?? ''}»`,
      project_id: id,
      task_id: taskId,
      team_member_id: memberId,
      recipient_team_member_id: memberId,
    })
  }

  async function removeAssignee(taskId: string, memberId: string) {
    await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('team_member_id', memberId)
    const next = (assigneesByTask[taskId] ?? []).filter(mid => mid !== memberId)
    setAssigneesByTask(prev => ({ ...prev, [taskId]: next }))
    const primary = next[0] ?? null
    await supabase.from('pm_tasks').update({ team_member_id: primary }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, team_member_id: primary } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, team_member_id: primary } : prev)
  }

  async function moveTask(taskId: string, toColumnId: string) {
    await supabase.from('pm_tasks').update({ column_id: toColumnId }).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, column_id: toColumnId } : t))
    setOpenMenu(null)
  }

  async function deleteTask(taskId: string) {
    await supabase.from('pm_tasks').delete().eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setAssigneesByTask(prev => { const next = { ...prev }; delete next[taskId]; return next })
    if (selectedTask?.id === taskId) setSelectedTask(null)
    setOpenMenu(null)
  }

  async function addColumn() {
    const name = newColName.trim()
    if (!name) return
    const { data } = await supabase
      .from('pm_columns')
      .insert({ project_id: id, name: name.toUpperCase(), color: newColColor, position: columns.length })
      .select()
      .single()
    setNewColName(''); setNewColColor('#6B7280'); setAddingColumn(false)
    if (data) setColumns(prev => [...prev, data])
  }

  async function deleteColumn(colId: string) {
    await supabase.from('pm_tasks').update({ column_id: null }).eq('column_id', colId)
    await supabase.from('pm_columns').delete().eq('id', colId)
    setColumns(prev => prev.filter(c => c.id !== colId))
    setTasks(prev => prev.map(t => t.column_id === colId ? { ...t, column_id: null } : t))
  }

  async function addProjectMember(memberId: string) {
    await supabase.from('project_members').insert({ project_id: id, team_member_id: memberId })
    await supabase.from('notifications').insert({
      type: 'project_added',
      message: `Вас додано до проєкту «${project?.name ?? ''}»`,
      project_id: id,
      team_member_id: memberId,
      recipient_team_member_id: memberId,
    })
    const m = members.find(m => m.id === memberId)
    if (m) setProjectMembers(prev => [...prev, m])
  }

  async function removeProjectMember(memberId: string) {
    await supabase.from('project_members').delete().eq('project_id', id).eq('team_member_id', memberId)
    setProjectMembers(prev => prev.filter(m => m.id !== memberId))
  }

  async function updateTask(taskId: string, patch: Partial<PMTask>) {
    await supabase.from('pm_tasks').update(patch).eq('id', taskId)
    // Notify designer when assigned
    if (patch.team_member_id) {
      const task = tasks.find(t => t.id === taskId)
      await supabase.from('notifications').insert({
        type: 'task_assigned',
        message: `Вам призначено задачу «${task?.title ?? ''}» у проєкті «${project?.name ?? ''}»`,
        project_id: id,
        task_id: taskId,
        team_member_id: patch.team_member_id,
        recipient_team_member_id: patch.team_member_id,
      })
    }
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...patch } : prev)
  }

  async function updateTaskDates(taskId: string, patch: { start_date?: string | null; due_date?: string | null }) {
    await supabase.from('pm_tasks').update(patch).eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Завантаження...</div>
  )

  if (dbError) return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-red-500 font-medium mb-2">Потрібна міграція бази даних</p>
        <p className="text-sm text-gray-500 mb-4">{dbError}</p>
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-4 text-left overflow-auto whitespace-pre-wrap">
{`alter table projects add column if not exists color text default '#14b8a6';

drop table if exists pm_columns cascade;
create table pm_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  color text not null default '#6B7280',
  position int not null default 0,
  created_at timestamptz default now()
);
alter table pm_columns enable row level security;
create policy "pm_columns_all" on pm_columns for all using (true) with check (true);

alter table pm_tasks add column if not exists column_id uuid references pm_columns(id) on delete set null;
alter table pm_tasks add column if not exists finance_project_id uuid references projects(id) on delete cascade;
alter table pm_tasks add column if not exists team_member_id uuid references team_members(id) on delete set null;
alter table pm_tasks alter column created_by drop not null;
alter table pm_tasks enable row level security;
create policy "pm_tasks_all" on pm_tasks for all using (true) with check (true);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text not null default 'designer',
  color text not null default '#14b8a6',
  access_token text not null unique default gen_random_uuid()::text,
  created_at timestamptz default now()
);
alter table team_members enable row level security;
create policy "team_members_all" on team_members for all using (true) with check (true);`}
        </pre>
      </div>
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* Board area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-semibold text-gray-900">{project?.name}</h1>
            {/* Tab switcher */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('board')}
                className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Борда
              </button>
              <button
                onClick={() => setView('gantt')}
                className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${view === 'gantt' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Гант
              </button>
            </div>
          </div>

          {/* Project member management */}
          <div className="flex items-center gap-1.5 relative" ref={memberRef}>
            {projectMembers.map(m => (
              <div key={m.id} title={m.name} className="relative group/avatar">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white cursor-default"
                  style={{ backgroundColor: m.color }}
                >
                  {memberInitial(m)}
                </div>
                <button
                  onClick={() => removeProjectMember(m.id)}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full hidden group-hover/avatar:flex items-center justify-center"
                  title={`Видалити ${m.name} з проєкту`}
                >
                  <X size={8} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setMemberPanelOpen(v => !v)}
              className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 ring-2 ring-white transition-colors"
              title="Додати учасника до проєкту"
            >
              <UserPlus size={12} />
            </button>

            {memberPanelOpen && (
              <div className="absolute right-0 top-9 z-30 bg-white rounded-xl shadow-lg border border-gray-100 py-2 min-w-[200px]">
                <p className="px-3 pb-2 text-[10px] text-gray-400 uppercase tracking-wide font-medium">Додати до проєкту</p>
                {members.filter(m => !projectMembers.find(pm => pm.id === m.id)).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Всі учасники вже додані</p>
                ) : (
                  members
                    .filter(m => !projectMembers.find(pm => pm.id === m.id))
                    .map(m => (
                      <button
                        key={m.id}
                        onClick={() => { addProjectMember(m.id); setMemberPanelOpen(false) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-sm text-gray-700 text-left"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                          style={{ backgroundColor: m.color }}
                        >
                          {memberInitial(m)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.role}</p>
                        </div>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        </div>

        {view === 'board' ? (
          <div className="flex gap-4 p-5 overflow-x-auto flex-1 items-start">
            {columns.map(col => {
              const colTasks = tasks.filter(t => t.column_id === col.id)
              return (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  tasks={colTasks}
                  columns={columns}
                  members={members}
                  assigneesByTask={assigneesByTask}
                  isAdding={addingInColumn === col.id}
                  onStartAdd={() => setAddingInColumn(col.id)}
                  onCancelAdd={() => setAddingInColumn(null)}
                  onAddTask={patch => addTask(col.id, patch)}
                  onSelectTask={t => setSelectedTask(t)}
                  onMoveTask={moveTask}
                  onDeleteTask={deleteTask}
                  onDeleteColumn={() => deleteColumn(col.id)}
                  openMenu={openMenu}
                  onOpenMenu={setOpenMenu}
                  menuRef={menuRef}
                />
              )
            })}

            {/* Add column */}
            <div className="flex-shrink-0 w-[260px]">
              {addingColumn ? (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <input
                    autoFocus
                    value={newColName}
                    onChange={e => setNewColName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingColumn(false); setNewColName('') } }}
                    placeholder="Назва колонки..."
                    className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300 mb-2"
                  />
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-gray-500">Колір:</label>
                    <input type="color" value={newColColor} onChange={e => setNewColColor(e.target.value)} className="w-8 h-6 rounded cursor-pointer border-0" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addColumn} className="flex-1 text-xs bg-gray-900 text-white rounded-lg py-1.5 hover:bg-gray-700">Додати</button>
                    <button onClick={() => { setAddingColumn(false); setNewColName('') }} className="text-gray-400 hover:text-gray-600 px-2"><X size={14} /></button>
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
        ) : (
          <div className="flex-1 overflow-hidden">
            <GanttView tasks={tasks} onUpdate={updateTaskDates} />
          </div>
        )}
      </div>

      {/* Task detail drawer */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          columns={columns}
          members={members}
          assigneeIds={assigneesByTask[selectedTask.id] ?? []}
          onAddAssignee={memberId => addAssignee(selectedTask.id, memberId)}
          onRemoveAssignee={memberId => removeAssignee(selectedTask.id, memberId)}
          onClose={() => setSelectedTask(null)}
          onUpdate={patch => updateTask(selectedTask.id, patch)}
          onDelete={() => deleteTask(selectedTask.id)}
          onMove={colId => moveTask(selectedTask.id, colId)}
        />
      )}
    </div>
  )
}

// ── Kanban column ──────────────────────────────────────────────────────────────

function KanbanColumn({
  col, tasks, columns, members, assigneesByTask, isAdding, onStartAdd, onCancelAdd, onAddTask,
  onSelectTask, onMoveTask, onDeleteTask, onDeleteColumn,
  openMenu, onOpenMenu, menuRef,
}: {
  col: PMColumn
  tasks: PMTask[]
  columns: PMColumn[]
  members: TeamMember[]
  assigneesByTask: Record<string, string[]>
  isAdding: boolean
  onStartAdd: () => void
  onCancelAdd: () => void
  onAddTask: (patch: Partial<PMTask> & { title: string; team_member_ids?: string[] }) => void
  onSelectTask: (t: PMTask) => void
  onMoveTask: (taskId: string, colId: string) => void
  onDeleteTask: (taskId: string) => void
  onDeleteColumn: () => void
  openMenu: string | null
  onOpenMenu: (id: string | null) => void
  menuRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex-shrink-0 w-[280px] flex flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
          <span className="text-xs font-bold tracking-wide uppercase" style={{ color: col.color }}>
            {col.name}
          </span>
          <span className="text-xs text-gray-400 font-medium">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onStartAdd} className="text-gray-400 hover:text-gray-600 p-1 rounded" title="Додати задачу">
            <Plus size={14} />
          </button>
          <button onClick={onDeleteColumn} className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors" title="Видалити колонку">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-200px)]">
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            columns={columns}
            members={members}
            assigneeIds={assigneesByTask[task.id] ?? []}
            isMenuOpen={openMenu === task.id}
            onOpenMenu={() => onOpenMenu(openMenu === task.id ? null : task.id)}
            onSelect={() => onSelectTask(task)}
            onMove={colId => onMoveTask(task.id, colId)}
            onDelete={() => onDeleteTask(task.id)}
            menuRef={openMenu === task.id ? menuRef : undefined}
          />
        ))}

        {/* Inline add task form */}
        {isAdding ? (
          <AddTaskForm members={members} onSave={onAddTask} onCancel={onCancelAdd} />
        ) : (
          <button
            onClick={onStartAdd}
            className="w-full flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus size={14} style={{ color: col.color }} />
            <span>Add Task</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Add task form (inline, ClickUp-style) ─────────────────────────────────────

function AddTaskForm({ members, onSave, onCancel }: {
  members: TeamMember[]
  onSave: (patch: Partial<PMTask> & { title: string; team_member_ids?: string[] }) => void
  onCancel: () => void
}) {
  const [title, setTitle]             = useState('')
  const [priority, setPriority]       = useState<'low'|'medium'|'high'|null>(null)
  const [dueDate, setDueDate]         = useState('')
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const dateRef = useRef<HTMLInputElement>(null)

  function toggleMember(memberId: string) {
    setSelectedMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    )
  }

  function handleSave() {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      priority: priority ?? 'medium',
      due_date: dueDate || null,
      team_member_ids: selectedMemberIds,
    })
    setTitle(''); setPriority(null); setDueDate(''); setSelectedMemberIds([])
  }

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="Task Name..."
          className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
        />
        <button
          onClick={handleSave}
          disabled={!title.trim()}
          className="ml-2 text-xs bg-gray-800 text-white px-3 py-1 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          Save ↵
        </button>
      </div>

      <div className="flex flex-col gap-1.5 mt-3 pt-2 border-t border-gray-100">
        {/* Assignees (multi-select chips) */}
        <span className="text-[11px] text-gray-400">Виконавці</span>
        <div className="flex items-center flex-wrap gap-1.5">
          {members.map(m => {
            const selected = selectedMemberIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                title={m.name}
                className={`flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-full border transition-colors ${
                  selected ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold"
                  style={{ backgroundColor: m.color }}
                >
                  {m.name.charAt(0)}
                </div>
                <span className={`text-xs ${selected ? 'text-teal-700 font-medium' : 'text-gray-500'}`}>{m.name}</span>
              </button>
            )
          })}
          {members.length === 0 && <span className="text-xs text-gray-300">Немає учасників</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        {/* Due date */}
        <button
          onClick={() => dateRef.current?.showPicker?.()}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Calendar size={13} />
          {dueDate ? new Date(dueDate).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : 'Add dates'}
        </button>
        <input ref={dateRef} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="sr-only" />
      </div>

      <div className="flex items-center gap-3 mt-2">
        {/* Priority */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Flag size={13} style={{ color: priority ? priorityColor(priority) : undefined }} />
          <select
            value={priority ?? ''}
            onChange={e => setPriority(e.target.value as 'low'|'medium'|'high' || null)}
            className="bg-transparent text-xs text-gray-400 focus:outline-none cursor-pointer hover:text-gray-600"
          >
            <option value="">Add priority</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <Tag size={13} /> Add tag
        </button>
      </div>
    </div>
  )
}

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task, columns, members, assigneeIds, isMenuOpen, onOpenMenu, onSelect, onMove, onDelete, menuRef,
}: {
  task: PMTask
  columns: PMColumn[]
  members: TeamMember[]
  assigneeIds: string[]
  isMenuOpen: boolean
  onOpenMenu: () => void
  onSelect: () => void
  onMove: (colId: string) => void
  onDelete: () => void
  menuRef?: React.RefObject<HTMLDivElement | null>
}) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 p-3.5 hover:border-gray-300 hover:shadow-sm transition-all group cursor-pointer select-none"
      onClick={onSelect}
    >
      {/* Title */}
      <p className="text-sm text-gray-800 leading-snug mb-3">{task.title}</p>

      {/* Description indicator */}
      {task.description && (
        <div className="flex items-center gap-1 mb-2 text-gray-400">
          <AlignLeft size={11} />
        </div>
      )}

      {/* Icon row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Assignee avatars */}
          <AvatarStack memberIds={assigneeIds} members={members} />

          {/* Due date */}
          <button
            onClick={e => e.stopPropagation()}
            className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-red-500' : 'text-gray-400'} hover:text-gray-600 transition-colors`}
          >
            <Calendar size={11} />
            {task.due_date
              ? new Date(task.due_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
              : <span className="opacity-40">—</span>
            }
          </button>

          {/* Priority flag */}
          <Flag size={11} style={{ color: priorityColor(task.priority) }} />

          {/* Tag placeholder */}
          <Tag size={11} className="text-gray-300" />
        </div>

        {/* Context menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={e => { e.stopPropagation(); onOpenMenu() }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 p-0.5 rounded transition-all"
          >
            <MoreHorizontal size={14} />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-6 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[170px]">
              <p className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide font-medium">Перемістити до</p>
              {columns.map(c => (
                <button
                  key={c.id}
                  onClick={e => { e.stopPropagation(); onMove(c.id) }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 ${task.column_id === c.id ? 'font-medium' : 'text-gray-700'}`}
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  <span style={task.column_id === c.id ? { color: c.color } : undefined}>{c.name}</span>
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
    </div>
  )
}

// ── Task detail panel ──────────────────────────────────────────────────────────

function TaskDetailPanel({
  task, columns, members, assigneeIds, onAddAssignee, onRemoveAssignee, onClose, onUpdate, onDelete, onMove,
}: {
  task: PMTask
  columns: PMColumn[]
  members: TeamMember[]
  assigneeIds: string[]
  onAddAssignee: (memberId: string) => void
  onRemoveAssignee: (memberId: string) => void
  onClose: () => void
  onUpdate: (patch: Partial<PMTask>) => void
  onDelete: () => void
  onMove: (colId: string) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc]   = useState(task.description ?? '')

  useEffect(() => { setTitle(task.title); setDesc(task.description ?? '') }, [task.id])

  function saveTitle() { const t = title.trim(); if (t && t !== task.title) onUpdate({ title: t }) }
  function saveDesc()  { const d = desc.trim(); if (d !== (task.description ?? '')) onUpdate({ description: d || null }) }

  const currentCol       = columns.find(c => c.id === task.column_id)
  const assignedMembers  = assigneeIds
    .map(mid => members.find(m => m.id === mid))
    .filter((m): m is TeamMember => !!m)
  const unassignedMembers = members.filter(m => !assigneeIds.includes(m.id))

  return (
    <div className="w-[480px] min-w-[480px] border-l border-gray-100 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {currentCol && (
            <button
              style={{ backgroundColor: currentCol.color + '22', color: currentCol.color }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide"
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentCol.color }} />
              {currentCol.name}
              <ChevronRight size={10} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDelete} className="text-gray-300 hover:text-red-400 p-1.5 rounded transition-colors"><Trash2 size={14} /></button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded transition-colors"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="px-6 pt-5 pb-3">
          <textarea
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            rows={2}
            className="w-full text-xl font-semibold text-gray-900 resize-none focus:outline-none leading-snug placeholder-gray-300"
            placeholder="Назва задачі"
          />
        </div>

        {/* Fields */}
        <div className="px-6 pb-4 flex flex-col gap-0.5">
          {/* Status */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-32">Status</span>
            <select
              value={task.column_id ?? ''}
              onChange={e => onMove(e.target.value)}
              className="flex-1 text-sm font-medium focus:outline-none bg-transparent cursor-pointer"
              style={{ color: currentCol?.color ?? '#374151' }}
            >
              {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Assignees */}
          <div className="flex items-start gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-32 flex-shrink-0 pt-1">Assignees</span>
            <div className="flex items-center flex-wrap gap-1.5">
              {assignedMembers.map(m => (
                <div
                  key={m.id}
                  className="flex items-center gap-1.5 pl-0.5 pr-1.5 py-0.5 rounded-full border border-gray-200 bg-white"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.name.charAt(0)}
                  </div>
                  <span className="text-xs text-gray-600">{m.name}</span>
                  <button
                    onClick={() => onRemoveAssignee(m.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                    title={`Прибрати ${m.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {assignedMembers.length === 0 && (
                <span className="text-sm text-gray-400 pt-1">Не призначено</span>
              )}
              {unassignedMembers.length > 0 && (
                <select
                  value=""
                  onChange={e => { if (e.target.value) onAddAssignee(e.target.value) }}
                  className="text-sm text-gray-400 focus:outline-none bg-transparent cursor-pointer hover:text-gray-600"
                >
                  <option value="">+ Додати</option>
                  {unassignedMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Priority */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-32">Priority</span>
            <select
              value={task.priority ?? 'medium'}
              onChange={e => onUpdate({ priority: e.target.value as PMTask['priority'] })}
              className="text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Dates */}
          <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
            <span className="text-sm text-gray-400 w-32">Dates</span>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Calendar size={13} />
              <input
                type="date"
                value={task.due_date ? task.due_date.split('T')[0] : ''}
                onChange={e => onUpdate({ due_date: e.target.value || null })}
                className="text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 mx-6" />

        {/* Description */}
        <div className="px-6 py-4">
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={saveDesc}
            rows={5}
            placeholder="Add description..."
            className="w-full text-sm text-gray-700 resize-none focus:outline-none placeholder-gray-300 leading-relaxed"
          />
        </div>

        {/* Quick actions */}
        <div className="border-t border-gray-100 mx-6" />
        <div className="px-6 py-3 flex flex-col gap-1">
          {[
            { icon: CheckSquare, label: 'Create checklist' },
            { icon: Tag,         label: 'Add tag' },
          ].map(({ icon: Icon, label }) => (
            <button key={label} className="flex items-center gap-2.5 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
