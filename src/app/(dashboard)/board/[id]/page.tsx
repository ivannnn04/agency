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
  Link2, Copy, MessageSquare, Clock, Send, Loader2, NotebookPen, ReceiptText, BarChart2,
} from 'lucide-react'
import GanttView from '@/components/GanttView'
import ProjectChat from '@/components/ProjectChat'
import ProjectNotepad from '@/components/ProjectNotepad'
import ProjectInvoices from '@/components/ProjectInvoices'
import ProjectReport from '@/components/ProjectReport'
import { useChatUnread } from '@/lib/chatUnread'
import { suggestEstimate } from '@/lib/preEstimate'
import MoveTaskProject from '@/components/MoveTaskProject'

interface ClientRow { id: string; email: string; name: string | null; invited_at?: string | null }
interface ChangeRequestRow {
  id: string
  content: string
  files: { url: string; name: string }[]
  status: 'open' | 'done'
  client_name: string | null
  created_at: string
}

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
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [clientPanelOpen, setClientPanelOpen] = useState(false)
  const [projectClients, setProjectClients] = useState<ClientRow[]>([])
  const [newClientEmail, setNewClientEmail] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [invitingClientId, setInvitingClientId] = useState<string | null>(null)
  const [invitedClientId, setInvitedClientId] = useState<string | null>(null)
  const [clientInviteError, setClientInviteError] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [notepadOpen, setNotepadOpen] = useState(false)
  const [invoicesOpen, setInvoicesOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  // Badge only — the Sidebar already plays the notification sound app-wide
  const chatUnread = useChatUnread({ self: 'admin', projectId: id, sound: false, intervalMs: 8000 })
  const clientRef = useRef<HTMLDivElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const memberRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { if (id) fetchAll() }, [id])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
      if (memberRef.current && !memberRef.current.contains(e.target as Node)) setMemberPanelOpen(false)
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) setClientPanelOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchAll() {
    setLoading(true)
    setDbError(null)
    const [{ data: proj }, { data: cols, error: colErr }, { data: tx }, { data: mems }, { data: pm }, { data: pc }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('pm_columns').select('*').eq('project_id', id).order('position'),
      supabase.from('pm_tasks').select('*').eq('finance_project_id', id).order('created_at'),
      supabase.from('team_members').select('*').order('created_at'),
      supabase.from('project_members').select('team_member_id').eq('project_id', id),
      supabase.from('project_clients').select('client_id, clients(id, email, name, invited_at)').eq('project_id', id),
    ])
    if (proj) setProject(proj)
    if (pc) {
      setProjectClients(
        (pc as unknown as { clients: ClientRow | null }[])
          .map(r => r.clients)
          .filter((c): c is ClientRow => !!c)
      )
    }
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
    const baseTask = {
      finance_project_id: id,
      column_id: columnId,
      title: patch.title,
      status: 'todo',
      priority: patch.priority ?? 'medium',
      team_member_id: primary,
      due_date: patch.due_date ?? null,
      description: null,
    }
    // Auto pre-estimate from the title; editable later. Retry without the
    // field if the estimate_hours column isn't in the DB yet.
    let { data, error } = await supabase
      .from('pm_tasks')
      .insert({ ...baseTask, estimate_hours: suggestEstimate(patch.title) })
      .select()
      .single()
    if (error && error.message.includes('estimate_hours')) {
      ;({ data, error } = await supabase.from('pm_tasks').insert(baseTask).select().single())
    }
    setAddingInColumn(null)
    if (error) {
      setDbError(`Помилка збереження задачі: ${error.message}`)
    } else if (data) {
      setTasks(prev => [...prev, data])
      if (memberIds.length > 0) {
        await supabase.from('task_assignees').insert(
          memberIds.map(mid => ({ task_id: data.id, team_member_id: mid }))
        )
        await ensureProjectMembers(memberIds)
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
    await ensureProjectMembers([memberId])
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

  // Assigning a task must also make the member part of the project —
  // otherwise their dashboard and board access won't include it
  // Move a task to another project: same-named column (or the leftmost one),
  // assignees follow as project members of the target project.
  async function moveTaskToProject(taskId: string, targetProjectId: string) {
    if (targetProjectId === id) return
    const task = tasks.find(t => t.id === taskId)
    const currentCol = columns.find(c => c.id === task?.column_id)
    const { data: cols } = await supabase
      .from('pm_columns')
      .select('id, name, position')
      .eq('project_id', targetProjectId)
      .order('position')
    const target =
      (cols ?? []).find(c => currentCol && c.name.toLowerCase() === currentCol.name.toLowerCase())
      ?? (cols ?? [])[0]
      ?? null
    const { error } = await supabase
      .from('pm_tasks')
      .update({ finance_project_id: targetProjectId, column_id: target?.id ?? null })
      .eq('id', taskId)
    if (error) { setDbError(`Не вдалося перенести задачу: ${error.message}`); return }
    const mids = assigneesByTask[taskId] ?? []
    if (mids.length > 0) {
      await supabase.from('project_members').upsert(
        mids.map(m => ({ project_id: targetProjectId, team_member_id: m })),
        { onConflict: 'project_id,team_member_id' }
      )
    }
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setSelectedTask(null)
  }

  async function ensureProjectMembers(memberIds: string[]) {
    const missing = memberIds.filter(mid => !projectMembers.some(m => m.id === mid))
    if (missing.length === 0) return
    await supabase.from('project_members').upsert(
      missing.map(mid => ({ project_id: id, team_member_id: mid })),
      { onConflict: 'project_id,team_member_id', ignoreDuplicates: true }
    )
    setProjectMembers(prev => [...prev, ...members.filter(m => missing.includes(m.id))])
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
      // Keep the assignees join table (the member's dashboard reads it) and
      // project membership in sync with this direct assignment
      await supabase.from('task_assignees').upsert(
        { task_id: taskId, team_member_id: patch.team_member_id },
        { onConflict: 'task_id,team_member_id', ignoreDuplicates: true }
      )
      const mid = patch.team_member_id
      setAssigneesByTask(prev => ({
        ...prev,
        [taskId]: prev[taskId]?.includes(mid) ? prev[taskId] : [...(prev[taskId] ?? []), mid],
      }))
      await ensureProjectMembers([mid])
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

  async function regenerateClientLink() {
    const token = crypto.randomUUID()
    const { error } = await supabase.from('projects').update({ client_access_token: token }).eq('id', id)
    if (!error) setProject(prev => prev ? { ...prev, client_access_token: token } : prev)
  }

  async function addClient() {
    const email = newClientEmail.trim().toLowerCase()
    if (!email) return
    let { data: client } = await supabase.from('clients').select('id, email, name').eq('email', email).single()
    if (!client) {
      const { data: created } = await supabase
        .from('clients')
        .insert({ email, name: newClientName.trim() || null })
        .select('id, email, name')
        .single()
      client = created
    }
    if (!client) return
    await supabase.from('project_clients').insert({ project_id: id, client_id: client.id })
    if (!projectClients.find(c => c.id === client!.id)) {
      setProjectClients(prev => [...prev, client!])
    }
    setNewClientEmail(''); setNewClientName('')
  }

  async function removeClient(clientId: string) {
    await supabase.from('project_clients').delete().eq('project_id', id).eq('client_id', clientId)
    setProjectClients(prev => prev.filter(c => c.id !== clientId))
  }

  async function inviteClient(clientId: string) {
    setInvitingClientId(clientId)
    setClientInviteError('')
    const res = await fetch('/api/clients/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, projectName: project?.name }),
    })
    const json = await res.json()
    setInvitingClientId(null)
    if (!res.ok) { setClientInviteError(json.error ?? 'Не вдалося надіслати запрошення'); return }
    setInvitedClientId(clientId)
    setTimeout(() => setInvitedClientId(null), 2500)
    setProjectClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, invited_at: new Date().toISOString() } : c
    ))
  }

  async function toggleShowHours() {
    const next = !project?.show_tracked_hours
    await supabase.from('projects').update({ show_tracked_hours: next }).eq('id', id)
    setProject(prev => prev ? { ...prev, show_tracked_hours: next } : prev)
  }

  async function updateCrLimit(limit: number) {
    const value = Math.max(0, Math.min(99, limit))
    await supabase.from('projects').update({ change_request_limit: value }).eq('id', id)
    setProject(prev => prev ? { ...prev, change_request_limit: value } : prev)
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
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0 flex items-center justify-between flex-wrap gap-2">
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

          {/* Right side: project members + client access */}
          <div className="flex items-center gap-3">
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

          {/* Client access */}
          <div className="relative" ref={clientRef}>
            <button
              onClick={() => setClientPanelOpen(v => !v)}
              className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 ring-2 ring-white transition-colors"
              title="Доступ для клієнта"
            >
              <Link2 size={12} />
            </button>

            {clientPanelOpen && (
              <div className="absolute right-0 top-9 z-30 bg-white rounded-xl shadow-lg border border-gray-100 p-3 w-[320px]">
                {/* Client accounts */}
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Акаунти клієнтів</p>
                <div className="flex flex-col gap-1.5 mb-2">
                  {projectClients.map(c => (
                    <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-2.5 py-1.5 gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{c.name || c.email}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {c.name ? c.email : ''}
                          {c.invited_at && (
                            <span className={`${c.name ? 'ml-1.5 ' : ''}text-teal-600 bg-teal-50 px-1 py-px rounded font-medium`}>
                              запрошено {new Date(c.invited_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => inviteClient(c.id)}
                          disabled={invitingClientId === c.id}
                          title="Надіслати запрошення на email — клієнт сам встановить пароль"
                          className={`flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-md transition-colors ${
                            invitedClientId === c.id
                              ? 'text-teal-700 bg-teal-50'
                              : 'text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100'
                          }`}
                        >
                          {invitingClientId === c.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <Send size={11} />}
                          {invitedClientId === c.id ? '✓' : c.invited_at ? 'Ще раз' : 'Запросити'}
                        </button>
                        <button onClick={() => removeClient(c.id)} className="text-gray-300 hover:text-red-400">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {projectClients.length === 0 && (
                    <p className="text-[11px] text-gray-300">Ще не додано жодного клієнта</p>
                  )}
                  {clientInviteError && (
                    <p className="text-[10px] text-red-500">{clientInviteError}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 mb-2">
                  <input
                    value={newClientEmail}
                    onChange={e => setNewClientEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addClient() }}
                    placeholder="client@email.com"
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <div className="flex gap-1.5">
                    <input
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addClient() }}
                      placeholder="Імʼя (опційно)"
                      className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <button
                      onClick={addClient}
                      disabled={!newClientEmail.trim()}
                      className="text-xs bg-gray-900 text-white rounded-lg px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40 flex-shrink-0"
                    >
                      Додати
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mb-3">
                  Додай клієнта і натисни «Запросити» — йому прийде лист, він сам встановить пароль
                  і потрапить у свій портал. Вхід надалі: <span className="font-medium text-gray-600">/portal/login</span>.
                </p>

                {/* Tracked hours toggle */}
                <div className="flex items-center justify-between border-t border-gray-100 pt-2.5 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-gray-400" />
                    <span className="text-xs text-gray-600">Показувати години клієнту</span>
                  </div>
                  <button
                    onClick={toggleShowHours}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                      project?.show_tracked_hours ? 'bg-teal-500' : 'bg-gray-200'
                    }`}
                    title={project?.show_tracked_hours ? 'Клієнт бачить затрекані години' : 'Години приховані від клієнта'}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${
                      project?.show_tracked_hours ? 'left-[18px]' : 'left-0.5'
                    }`} />
                  </button>
                </div>

                {/* Change request limit */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-600">Ліміт change requests / задачу</span>
                  <input
                    type="number" min={0} max={99}
                    value={project?.change_request_limit ?? 3}
                    onChange={e => updateCrLimit(Number(e.target.value))}
                    className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>

                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2 border-t border-gray-100 pt-2.5">Публічне посилання (read-only)</p>
                {project?.client_access_token ? (
                  <>
                    <div className="flex items-center gap-1.5 mb-2">
                      <input
                        readOnly
                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/client/${project.client_access_token}`}
                        onFocus={e => e.target.select()}
                        className="flex-1 min-w-0 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5"
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/client/${project.client_access_token}`)}
                        className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                        title="Скопіювати"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-2">Клієнт бачить статус проєкту та задачі без фінансових даних, без входу.</p>
                    <button
                      onClick={regenerateClientLink}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      Скинути посилання
                    </button>
                  </>
                ) : (
                  <button
                    onClick={regenerateClientLink}
                    className="w-full text-xs bg-gray-900 text-white rounded-lg py-1.5 hover:bg-gray-700"
                  >
                    Створити посилання для клієнта
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Admin-only project report: tasks, tracked hours, budget vs costs */}
          <button
            onClick={() => { setSelectedTask(null); setChatOpen(false); setNotepadOpen(false); setInvoicesOpen(false); setReportOpen(v => !v) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              reportOpen ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Звіт: таски, години, бюджет (бачите тільки ви)"
          >
            <BarChart2 size={13} /> Звіт
          </button>

          {/* Invoices — admin & client only, the team never sees these */}
          <button
            onClick={() => { setSelectedTask(null); setChatOpen(false); setNotepadOpen(false); setReportOpen(false); setInvoicesOpen(v => !v) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              invoicesOpen ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Інвойси проєкту (бачите ви і клієнт)"
          >
            <ReceiptText size={13} /> Інвойси
          </button>

          {/* Project notepad */}
          <button
            onClick={() => { setSelectedTask(null); setChatOpen(false); setInvoicesOpen(false); setNotepadOpen(v => !v) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              notepadOpen ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Нотатки проєкту"
          >
            <NotebookPen size={13} /> Нотатки
          </button>

          {/* Project chat */}
          <button
            onClick={() => { setSelectedTask(null); setNotepadOpen(false); setInvoicesOpen(false); setChatOpen(v => !v) }}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              chatOpen ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Чат проєкту"
          >
            <MessageSquare size={13} /> Чат
            {!chatOpen && (chatUnread[id]?.team || chatUnread[id]?.client) && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white animate-pulse ${
                chatUnread[id]?.clientNew ? 'bg-amber-400' : 'bg-teal-400'
              }`} />
            )}
          </button>
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
                  onSelectTask={t => { setChatOpen(false); setSelectedTask(t) }}
                  onMoveTask={moveTask}
                  onDeleteTask={deleteTask}
                  onDeleteColumn={() => deleteColumn(col.id)}
                  openMenu={openMenu}
                  onOpenMenu={setOpenMenu}
                  menuRef={menuRef}
                  dragOverCol={dragOverCol}
                  onDragOverCol={setDragOverCol}
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

      {/* Project chat drawer */}
      {chatOpen && (
        <ProjectChat
          projectId={id}
          projectName={project?.name}
          sender={{ type: 'admin', name: 'Ivan' }}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Project notepad drawer */}
      {notepadOpen && (
        <ProjectNotepad
          projectId={id}
          viewer={{ type: 'admin', name: 'Ivan' }}
          onClose={() => setNotepadOpen(false)}
        />
      )}

      {/* Invoices drawer (admin) */}
      {invoicesOpen && (
        <ProjectInvoices projectId={id} onClose={() => setInvoicesOpen(false)} />
      )}

      {/* Admin-only report drawer */}
      {reportOpen && project && (
        <ProjectReport project={project} members={members} onClose={() => setReportOpen(false)} />
      )}

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
          onMoveProject={pid => moveTaskToProject(selectedTask.id, pid)}
        />
      )}
    </div>
  )
}

// ── Kanban column ──────────────────────────────────────────────────────────────

function KanbanColumn({
  col, tasks, columns, members, assigneesByTask, isAdding, onStartAdd, onCancelAdd, onAddTask,
  onSelectTask, onMoveTask, onDeleteTask, onDeleteColumn,
  openMenu, onOpenMenu, menuRef, dragOverCol, onDragOverCol,
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
  dragOverCol: string | null
  onDragOverCol: (colId: string | null) => void
}) {
  return (
    <div
      className={`flex-shrink-0 w-[280px] flex flex-col rounded-xl transition-colors ${dragOverCol === col.id ? 'bg-teal-50/70 ring-2 ring-teal-300' : ''}`}
      onDragOver={e => { e.preventDefault(); onDragOverCol(col.id) }}
      onDragLeave={() => onDragOverCol(dragOverCol === col.id ? null : dragOverCol)}
      onDrop={e => {
        e.preventDefault()
        onDragOverCol(null)
        const taskId = e.dataTransfer.getData('text/plain')
        if (taskId) onMoveTask(taskId, col.id)
      }}
    >
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
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="bg-white rounded-xl border border-gray-100 p-3.5 hover:border-gray-300 hover:shadow-sm transition-all group cursor-pointer active:cursor-grabbing select-none"
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
  task, columns, members, assigneeIds, onAddAssignee, onRemoveAssignee, onClose, onUpdate, onDelete, onMove, onMoveProject,
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
  onMoveProject: (projectId: string) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc]   = useState(task.description ?? '')
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRow[]>([])

  useEffect(() => { setTitle(task.title); setDesc(task.description ?? '') }, [task.id])

  useEffect(() => {
    supabase.from('change_requests')
      .select('id, content, files, status, client_name, created_at')
      .eq('task_id', task.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setChangeRequests((data ?? []) as ChangeRequestRow[]))
  }, [task.id])

  async function toggleCrStatus(cr: ChangeRequestRow) {
    const next = cr.status === 'open' ? 'done' : 'open'
    await supabase.from('change_requests').update({ status: next }).eq('id', cr.id)
    setChangeRequests(prev => prev.map(c => c.id === cr.id ? { ...c, status: next } : c))
  }

  function saveTitle() { const t = title.trim(); if (t && t !== task.title) onUpdate({ title: t }) }
  function saveDesc()  { const d = desc.trim(); if (d !== (task.description ?? '')) onUpdate({ description: d || null }) }

  const currentCol       = columns.find(c => c.id === task.column_id)
  const assignedMembers  = assigneeIds
    .map(mid => members.find(m => m.id === mid))
    .filter((m): m is TeamMember => !!m)
  const unassignedMembers = members.filter(m => !assigneeIds.includes(m.id))

  return (
    <div className="fixed inset-0 z-40 md:static md:z-auto w-full md:w-[480px] md:min-w-[480px] border-l border-gray-100 bg-white flex flex-col h-full overflow-hidden">
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

        {/* Tracked time (who + how much) */}
        <TaskTrackedTime taskId={task.id} members={members} />

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

          {/* Move to another project */}
          {task.finance_project_id && (
            <MoveTaskProject currentProjectId={task.finance_project_id} onMove={onMoveProject} />
          )}

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

        {/* Change requests from the client */}
        {changeRequests.length > 0 && (
          <>
            <div className="border-t border-gray-100 mx-6" />
            <div className="px-6 py-4">
              <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-2.5">
                Change requests від клієнта · {changeRequests.length}
              </p>
              <div className="flex flex-col gap-2.5">
                {changeRequests.map(cr => (
                  <div key={cr.id} className={`rounded-xl border p-3 ${
                    cr.status === 'open' ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100 bg-gray-50 opacity-70'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-gray-500">
                        <span className="font-semibold text-gray-700">{cr.client_name ?? 'Клієнт'}</span>
                        {' · '}
                        {new Date(cr.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <button
                        onClick={() => toggleCrStatus(cr)}
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                          cr.status === 'open'
                            ? 'bg-white border border-amber-200 text-amber-600 hover:bg-amber-100'
                            : 'bg-teal-50 border border-teal-200 text-teal-600'
                        }`}
                      >
                        {cr.status === 'open' ? 'Позначити виконаним' : '✓ Виконано'}
                      </button>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{cr.content}</p>
                    {cr.files?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cr.files.map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noreferrer"
                            className="text-[11px] bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-600 hover:border-teal-300 hover:text-teal-600 transition-colors truncate max-w-[160px]">
                            📎 {f.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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

// ── Tracked time summary inside the admin task panel ────────────────────────────

function TaskTrackedTime({ taskId, members }: { taskId: string; members: TeamMember[] }) {
  const [byMember, setByMember] = useState<Record<string, number>>({})

  useEffect(() => {
    supabase
      .from('time_entries')
      .select('team_member_id, duration_seconds')
      .eq('task_id', taskId)
      .not('ended_at', 'is', null)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        for (const e of data ?? []) {
          map[e.team_member_id] = (map[e.team_member_id] ?? 0) + (e.duration_seconds ?? 0)
        }
        setByMember(map)
      })
  }, [taskId])

  const total = Object.values(byMember).reduce((a, b) => a + b, 0)
  if (total === 0) return null

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h === 0) return `${m}хв`
    return m > 0 ? `${h}г ${m}хв` : `${h}г`
  }

  return (
    <div className="mx-6 mb-3 p-3.5 bg-gray-50 rounded-xl">
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <Clock size={12} /> Затрекано
        </span>
        <span className="text-sm font-bold text-gray-900">{fmt(total)}</span>
      </div>
      <div className="flex flex-col gap-1">
        {Object.entries(byMember)
          .sort((a, b) => b[1] - a[1])
          .map(([mid, secs]) => {
            const m = members.find(x => x.id === mid)
            return (
              <div key={mid} className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                  style={{ backgroundColor: m?.color ?? '#9ca3af' }}
                >
                  {(m?.name ?? '?').charAt(0)}
                </div>
                <span className="text-xs text-gray-600 truncate">{m?.name ?? 'Невідомо'}</span>
                <span className="ml-auto text-xs text-gray-500">{fmt(secs)}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
