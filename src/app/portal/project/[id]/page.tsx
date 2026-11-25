'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  ArrowUpRight, Calendar, Flag, Clock, MessageSquare, X, FilePen, Paperclip, Loader2, CalendarDays, Download,
  NotebookPen, Plus, ReceiptText, CircleCheck, AlertTriangle, Users, FilePen as CrIcon,
} from 'lucide-react'
import {
  MentionComposer, MessageBody, Attachment, fileTooBig, MAX_FILE_MB, safeStoragePath,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips, DropZone, groupMessages, GalleryBubble, useTyping, TypingLine,
} from '@/components/chat/shared'
import GanttView from '@/components/GanttView'
import ProjectNotepad from '@/components/ProjectNotepad'
import PortalHours, { TrackedDay } from '@/components/portal/PortalHours'
import PortalTaskDrawer from '@/components/portal/PortalTaskDrawer'
import { PortalHeader, PortalPreviewBanner } from '@/components/portal/PortalChrome'
import { PORTAL_TEXT, PortalLang, PortalText, portalLang, portalLocale } from '@/lib/portalI18n'

interface PortalColumn { id: string; name: string; color: string; position: number }
interface PortalTask {
  id: string; title: string; description: string | null
  // The description with its formatting, shown read-only
  description_html?: string | null
  column_id: string | null; priority: string | null
  start_date: string | null; due_date: string | null
  // A task the client asked for, on its way through estimate → approval
  estimate_status?: 'needed' | 'sent' | 'changes' | 'approved' | null
  estimate_hours?: number | null
  estimate_rate?: number | null
  estimate_cost?: number | null
  estimate_note?: string | null
  estimate_client_comment?: string | null
}

// Not on the board yet: waiting for the team's estimate or the client's answer
const isEstimatePending = (x: PortalTask) => ['needed', 'sent', 'changes'].includes(x.estimate_status ?? '')
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
    start_date?: string | null
    deadline?: string | null
  }
  phases?: { id: string; title: string; start_date: string | null; end_date: string | null; done: boolean }[]
  lang?: string
  columns: PortalColumn[]
  tasks: PortalTask[]
  assigneesByTask: Record<string, string[]>
  timeByTask: Record<string, number> | null
  // Tracked time per day and task (dates only), when hours are shown
  timeByDay?: TrackedDay[] | null
  // Subtasks per task, read-only: what they are and which are done
  subtasksByTask?: Record<string, { title: string; done: boolean }[]>
  // Amounts behind the hours, when the team shows them
  billing?: {
    rate: number
    currency: string
    amountByTask: Record<string, number>
    tracked_total: number
    pending: { not_invoiced: number; invoiced_unpaid: number; total: number }
  } | null
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
const LANG_KEY = 'gudrix:portalLang'

function formatHours(seconds: number, lang: PortalLang): string {
  const [hh, mm] = lang === 'uk' ? [' год', ' хв'] : ['h', 'm']
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}${mm}`
  return m > 0 ? `${h}${hh} ${m}${mm}` : `${h}${hh}`
}

const money = (sym: string, n: number) =>
  `${sym}${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`border border-gray-100 rounded-3xl bg-white p-6 lg:p-8 ${className}`}>{children}</section>
}
const Eyebrow = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-xs font-medium uppercase tracking-[0.12em] text-gray-400 ${className}`}>{children}</p>
)

// ── Client-facing project dashboard (the Overview view) ────────────────────────
// Everything is computed from the payload the page already has — the last
// board column counts as "done".
function OverviewDashboard({ data, sym, t, lang, onOpenBoard, onOpenChat }: {
  data: PortalProjectData
  sym: string
  t: PortalText
  lang: PortalLang
  onOpenBoard: () => void
  onOpenChat: () => void
}) {
  const { project, columns, assigneesByTask, timeByTask, people, changeRequests } = data
  const billing = data.billing ?? null
  // Tasks still being estimated are not part of the plan yet
  const tasks = data.tasks.filter(x => !isEstimatePending(x))
  const toApprove = data.tasks.filter(x => x.estimate_status === 'sent').length
  const lastCol = columns.length > 0 ? columns[columns.length - 1] : null
  const doneIds = new Set(tasks.filter(x => x.column_id === lastCol?.id).map(x => x.id))
  const total = tasks.length
  const done = doneIds.size
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00')
  const overdue = tasks
    .filter(x => x.due_date && !doneIds.has(x.id) && day(x.due_date) < today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
  const upcoming = tasks
    .filter(x => x.due_date && !doneIds.has(x.id) && day(x.due_date) >= today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    .slice(0, 6)

  const trackedTotal = timeByTask ? Object.values(timeByTask).reduce((s, v) => s + v, 0) : null
  const openCrs = (changeRequests ?? []).filter(c => c.status === 'open')
  const locale = portalLocale(lang)
  const fmtDate = (d: string) => day(d).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const fmtLong = (d: string) => day(d).toLocaleDateString(locale, { month: 'long', day: 'numeric' })
  const taskById: Record<string, PortalTask> = {}
  for (const x of tasks) taskById[x.id] = x
  const phases = data.phases ?? []
  const daysLeft = project.deadline ? Math.round((day(project.deadline).getTime() - today.getTime()) / 86_400_000) : null
  const elapsed = project.start_date && project.deadline && day(project.deadline) > day(project.start_date)
    ? Math.max(0, Math.min(100, Math.round(((today.getTime() - day(project.start_date).getTime()) / (day(project.deadline).getTime() - day(project.start_date).getTime())) * 100)))
    : null

  const stats: { icon: React.ReactNode; label: string; value: React.ReactNode; alert?: boolean }[] = [
    { icon: <CircleCheck size={14} />, label: t.done, value: <>{done}<span className="text-gray-300 font-normal"> / {total}</span></> },
    { icon: <AlertTriangle size={14} />, label: t.overdue, value: overdue.length, alert: overdue.length > 0 },
    { icon: <CrIcon size={14} />, label: t.openRequests, value: openCrs.length },
    trackedTotal != null
      ? { icon: <Clock size={14} />, label: t.hoursLogged, value: formatHours(trackedTotal, lang) }
      : (project.contract_amount ?? 0) > 0
        ? { icon: <ReceiptText size={14} />, label: t.budget, value: `${sym}${project.contract_amount!.toLocaleString('en-US')}` }
        : { icon: <Users size={14} />, label: t.team, value: people.length },
  ]

  return (
    <div className="px-5 sm:px-8 lg:px-12 py-8 grid grid-cols-12 gap-5">
      {/* An estimate is waiting for the client's answer */}
      {toApprove > 0 && (
        <button
          onClick={onOpenBoard}
          className="col-span-12 text-left border border-[#2affaa] bg-[#2affaa]/10 rounded-3xl px-6 lg:px-8 py-5 flex items-center justify-between gap-4 flex-wrap hover:bg-[#2affaa]/20 transition-colors"
        >
          <span>
            <span className="block text-lg font-semibold text-gray-900 tracking-tight">{t.estWaiting(toApprove)}</span>
            <span className="block text-sm text-gray-500 mt-0.5">{t.estWaitingSub}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 bg-teal-500 text-white px-4 py-2 rounded-full text-sm font-medium">
            {t.estReview} <ArrowUpRight size={15} />
          </span>
        </button>
      )}

      {/* Progress */}
      <Card className="col-span-12 xl:col-span-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <Eyebrow>{t.progress}</Eyebrow>
            <p className="text-6xl lg:text-7xl font-semibold text-gray-900 tracking-tight leading-none mt-3">{progress}%</p>
          </div>
          <p className="text-sm text-gray-500 pb-1">{t.tasksDone(done, total)}</p>
        </div>
        {/* One bar, split by stage */}
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex mt-7">
          {columns.map(col => {
            const n = tasks.filter(x => x.column_id === col.id).length
            return n > 0 ? <div key={col.id} style={{ width: `${(n / total) * 100}%`, backgroundColor: col.color }} title={`${col.name}: ${n}`} /> : null
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-x-8 gap-y-3 mt-6">
          {columns.map(col => (
            <div key={col.id} className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
              <span className="text-sm text-gray-600 truncate flex-1">{col.name}</span>
              <span className="text-sm font-semibold text-gray-900 tabular-nums">{tasks.filter(x => x.column_id === col.id).length}</span>
            </div>
          ))}
        </div>
        <button onClick={onOpenBoard} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 mt-7 hover:gap-2.5 transition-all">
          {t.openBoard} <ArrowUpRight size={15} />
        </button>
      </Card>

      {/* Deadline */}
      <section className="col-span-12 xl:col-span-4 on-dark rounded-3xl bg-[#00140c] text-white p-6 lg:p-8 flex flex-col">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/40">{t.deadline}</p>
        <p className="text-4xl lg:text-5xl font-semibold tracking-tight leading-none mt-3">
          {project.deadline ? fmtLong(project.deadline) : <span className="text-white/30">{t.notSet}</span>}
        </p>
        {daysLeft !== null && (
          <span className={`self-start text-xs font-semibold px-2.5 py-1 rounded-full mt-4 ${daysLeft < 0 ? 'bg-red-500 text-white' : 'bg-[#2affaa] text-[#00140c]'}`}>
            {t.daysLeft(daysLeft)}
          </span>
        )}
        <div className="mt-auto pt-8">
          {elapsed !== null && (
            <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-[#2affaa] rounded-full" style={{ width: `${elapsed}%` }} />
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/40">{t.start}</span>
            <span className="text-white/80">{project.start_date ? fmtLong(project.start_date) : t.notSet}</span>
          </div>
        </div>
      </section>

      {/* Numbers */}
      <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((s, i) => (
          <Card key={i} className="!p-6">
            <p className="flex items-center gap-2 text-xs text-gray-400">{s.icon} {s.label}</p>
            <p className={`text-3xl font-semibold tracking-tight mt-3 ${s.alert ? 'text-red-500' : 'text-gray-900'}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Money behind the hours */}
      {billing && (
        <Card className="col-span-12">
          <Eyebrow>{t.billing}</Eyebrow>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-0 md:divide-x divide-gray-100 mt-5">
            <div className="md:pr-8">
              <p className="text-xs text-gray-400">{t.billRate}</p>
              <p className="text-3xl font-semibold tracking-tight text-gray-900 mt-2">
                {money(sym, billing.rate)}<span className="text-base text-gray-400 font-normal">{t.estPerHour}</span>
              </p>
            </div>
            <div className="md:px-8">
              <p className="text-xs text-gray-400">{t.billTracked}</p>
              <p className="text-3xl font-semibold tracking-tight text-gray-900 mt-2">{money(sym, billing.tracked_total)}</p>
              {trackedTotal != null && trackedTotal > 0 && <p className="text-xs text-gray-400 mt-1">{t.billHours(formatHours(trackedTotal, lang))}</p>}
            </div>
            <div className="md:pl-8">
              <p className="text-xs text-gray-400">{t.billPending}</p>
              <p className={`text-3xl font-semibold tracking-tight mt-2 ${billing.pending.total > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{money(sym, billing.pending.total)}</p>
              {billing.pending.total > 0 && (
                <p className="text-xs text-gray-400 mt-1">{t.billPendingSplit(money(sym, billing.pending.invoiced_unpaid), money(sym, billing.pending.not_invoiced))}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-5">{t.billNote}</p>
        </Card>
      )}

      {/* Roadmap */}
      <Card className="col-span-12 xl:col-span-7">
        <Eyebrow>{t.roadmap}</Eyebrow>
        {phases.length === 0 ? (
          <p className="text-sm text-gray-400 mt-4">{t.roadmapEmpty}</p>
        ) : (
          <div className="mt-3 divide-y divide-gray-100">
            {phases.map((ph, i) => {
              const late = !ph.done && !!ph.end_date && day(ph.end_date) < today
              const active = !ph.done && !late && !!ph.start_date && day(ph.start_date) <= today
              return (
                <div key={ph.id} className="flex items-center gap-4 py-4">
                  <span className="text-xs text-gray-300 tabular-nums w-5">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`text-base flex-1 min-w-0 truncate ${ph.done ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>{ph.title}</span>
                  <span className="text-sm text-gray-400 flex-shrink-0 hidden sm:block">
                    {ph.start_date ? fmtDate(ph.start_date) : '—'} – {ph.end_date ? fmtDate(ph.end_date) : '—'}
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                    ph.done ? 'bg-green-100 text-green-700' : late ? 'bg-red-50 text-red-600' : active ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {ph.done ? t.phaseDone : late ? t.phaseLate : active ? t.phaseActive : t.phasePlanned}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Deadlines */}
      <Card className="col-span-12 xl:col-span-5">
        <Eyebrow>{t.deadlines}</Eyebrow>
        {overdue.length === 0 && upcoming.length === 0 ? (
          <p className="text-sm text-gray-400 mt-4">{t.noDated}</p>
        ) : (
          <div className="mt-3 divide-y divide-gray-100">
            {[...overdue, ...upcoming].map(x => {
              const late = day(x.due_date!) < today
              return (
                <div key={x.id} className="flex items-center gap-3 py-3.5">
                  <span className="text-sm text-gray-900 flex-1 min-w-0 truncate">{x.title}</span>
                  {(assigneesByTask[x.id] ?? []).length > 0 && (
                    <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[140px]">{assigneesByTask[x.id].join(', ')}</span>
                  )}
                  <span className={`text-sm tabular-nums whitespace-nowrap ${late ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>{fmtDate(x.due_date!)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Team */}
      <Card className="col-span-12 lg:col-span-5 xl:col-span-4">
        <Eyebrow>{t.yourTeam}</Eyebrow>
        {people.length === 0 ? (
          <p className="text-sm text-gray-400 mt-4">{t.teamAssigning}</p>
        ) : (
          <div className="flex flex-col gap-3 mt-4">
            {people.map(name => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 text-sm font-semibold flex items-center justify-center">{name.charAt(0)}</span>
                <span className="text-sm text-gray-900">{name}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onOpenChat} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 mt-6 hover:gap-2.5 transition-all">
          {t.messageTeam} <ArrowUpRight size={15} />
        </button>
      </Card>

      {/* Change requests */}
      <Card className="col-span-12 lg:col-span-7 xl:col-span-8">
        <Eyebrow>{t.changeRequests}</Eyebrow>
        {(changeRequests ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 mt-4">{t.crEmpty}</p>
        ) : (
          <div className="mt-3 divide-y divide-gray-100">
            {(changeRequests ?? []).slice(0, 5).map(cr => (
              <div key={cr.id} className="flex items-start gap-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 line-clamp-2">{cr.content || t.attachedFiles}</p>
                  {taskById[cr.task_id] && <p className="text-xs text-gray-400 truncate mt-0.5">{taskById[cr.task_id].title}</p>}
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${cr.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {cr.status === 'done' ? t.crDone : t.crOpen}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── A client-requested task on its way through estimate → approval ───────────

function EstimateCard({ task, projectId, token, readOnly, focused, sym, t, onDecided }: {
  task: PortalTask
  projectId: string
  token: string | null
  readOnly: boolean
  focused: boolean
  sym: string
  t: PortalText
  onDecided: () => void
}) {
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function decide(action: 'approve' | 'comment') {
    if (!token || busy || readOnly) return
    if (action === 'comment' && !comment.trim()) return
    setBusy(true); setError('')
    const res = await fetch(`/api/portal/project/${projectId}/tasks/${task.id}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, comment }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? t.somethingWrong)
      return
    }
    onDecided()
  }

  const sent = task.estimate_status === 'sent'
  const hours = task.estimate_hours ?? 0, rate = task.estimate_rate ?? 0, cost = task.estimate_cost ?? 0

  return (
    <div
      id={`task-${task.id}`}
      className={`border rounded-2xl p-4 bg-white transition-shadow ${focused ? 'border-[#2affaa] shadow-[0_0_0_4px_rgba(42,255,170,0.25)]' : sent ? 'border-gray-900' : 'border-gray-100'}`}
    >
      <p className="text-[15px] text-gray-900 leading-snug font-medium">{task.title}</p>
      {task.description && <p className="text-sm text-gray-400 mt-1.5 line-clamp-3">{task.description}</p>}

      {!sent ? (
        <>
          <span className="inline-block text-xs font-medium text-violet-700 bg-violet-50 rounded-full px-2.5 py-1 mt-3">
            {task.estimate_status === 'changes' ? t.estRevising : t.estNeeded}
          </span>
          {task.estimate_status === 'changes' && task.estimate_client_comment ? (
            <p className="text-sm text-gray-500 mt-2.5"><span className="text-gray-400">{t.estYourComment}:</span> {task.estimate_client_comment}</p>
          ) : (
            <p className="text-sm text-gray-400 mt-2.5 leading-relaxed">{t.estNeededSub}</p>
          )}
        </>
      ) : (
        <>
          <span className="inline-block text-xs font-medium text-white bg-teal-500 rounded-full px-2.5 py-1 mt-3">{t.estReady}</span>
          <div className="flex items-end gap-x-7 gap-y-2 flex-wrap mt-3">
            {hours > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{t.estTime}</p>
                <p className="text-2xl font-semibold text-gray-900 tracking-tight">{t.estHours(hours)}</p>
              </div>
            )}
            {rate > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{t.estRate}</p>
                <p className="text-2xl font-semibold text-gray-900 tracking-tight">{sym}{rate.toLocaleString('en-US')}<span className="text-sm text-gray-400 font-normal">{t.estPerHour}</span></p>
              </div>
            )}
            {cost > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{t.estCost}</p>
                <p className="text-2xl font-semibold text-gray-900 tracking-tight">{sym}{cost.toLocaleString('en-US')}</p>
              </div>
            )}
          </div>
          {task.estimate_note && <p className="text-sm text-gray-500 mt-3 whitespace-pre-line leading-relaxed">{task.estimate_note}</p>}
          {cost > 0 && <p className="text-xs text-gray-400 mt-3">{t.estBudgetNote(`${sym}${cost.toLocaleString('en-US')}`)}</p>}

          {commenting ? (
            <div className="mt-4">
              <textarea
                autoFocus
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder={t.estCommentPh}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gray-900 resize-none"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={() => { setCommenting(false); setError('') }} className="flex-1 border border-gray-200 text-gray-600 rounded-full py-2 text-sm font-medium hover:border-gray-900 transition-colors">
                  {t.cancel}
                </button>
                <button onClick={() => decide('comment')} disabled={busy || !comment.trim()} className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-full py-2 text-sm font-medium transition-colors">
                  {busy ? t.submitting : t.estSend}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 mt-4">
              <button onClick={() => decide('approve')} disabled={busy || readOnly} className="flex-1 flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-full py-2 text-sm font-medium transition-colors">
                <CircleCheck size={14} /> {busy ? t.submitting : t.estApprove}
              </button>
              <button onClick={() => setCommenting(true)} disabled={busy || readOnly} className="flex-1 border border-gray-200 text-gray-700 rounded-full py-2 text-sm font-medium hover:border-gray-900 disabled:opacity-40 transition-colors">
                {t.estAskChanges}
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </>
      )}
    </div>
  )
}

// ── Invoices as a full-width table ────────────────────────────────────────────

interface InvoiceRow {
  id: string; title: string; amount: number | null; currency: string
  file_url: string | null; file_name: string | null; status: 'to_be_paid' | 'paid'
  created_at: string; paid_at: string | null
}

function PortalInvoices({ projectId, token, t, lang }: { projectId: string; token: string; t: PortalText; lang: PortalLang }) {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)

  useEffect(() => {
    fetch(`/api/portal/project/${projectId}/invoices`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : { invoices: [] }))
      .then(d => setInvoices(d.invoices ?? []))
      .catch(() => setInvoices([]))
  }, [projectId, token])

  const locale = portalLocale(lang)
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const money = (n: number, cur: string) => `${CURRENCY_SYMBOL[cur] ?? ''}${n.toLocaleString('en-US')}`
  const sumBy = (rows: InvoiceRow[]) => {
    const by: Record<string, number> = {}
    for (const r of rows) if (r.amount != null) by[r.currency] = (by[r.currency] ?? 0) + Number(r.amount)
    return Object.entries(by).map(([c, v]) => money(v, c)).join(' + ') || '—'
  }

  if (!invoices) return <p className="px-5 sm:px-8 lg:px-12 py-10 text-sm text-gray-400">{t.loading}</p>
  const paid = invoices.filter(i => i.status === 'paid')
  const due = invoices.filter(i => i.status !== 'paid')

  return (
    <div className="px-5 sm:px-8 lg:px-12 py-8 flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="!p-6"><Eyebrow>{t.invBilled}</Eyebrow><p className="text-3xl font-semibold tracking-tight text-gray-900 mt-3">{sumBy(invoices)}</p></Card>
        <Card className="!p-6"><Eyebrow>{t.invPaid}</Eyebrow><p className="text-3xl font-semibold tracking-tight text-gray-900 mt-3">{sumBy(paid)}</p></Card>
        <section className="on-dark rounded-3xl bg-[#00140c] text-white p-6">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/40">{t.invOutstanding}</p>
          <p className="text-3xl font-semibold tracking-tight mt-3">{sumBy(due)}</p>
        </section>
      </div>

      <Card className="!p-0 overflow-hidden">
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-20 flex flex-col items-center gap-3">
            <ReceiptText size={26} className="opacity-30" /> {t.invNone}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  {[t.invTitle, t.invIssued, t.invAmount, t.invStatus, t.invFile].map((h, i) => (
                    <th key={h} className={`text-xs font-medium uppercase tracking-[0.12em] text-gray-400 px-6 lg:px-8 py-4 ${i === 2 ? 'text-right' : ''} ${i === 4 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-6 lg:px-8 py-5 text-base font-medium text-gray-900">{inv.title}</td>
                    <td className="px-6 lg:px-8 py-5 text-sm text-gray-500 whitespace-nowrap">{fmtDate(inv.created_at)}</td>
                    <td className="px-6 lg:px-8 py-5 text-base font-semibold text-gray-900 text-right tabular-nums whitespace-nowrap">
                      {inv.amount != null ? money(Number(inv.amount), inv.currency) : '—'}
                    </td>
                    <td className="px-6 lg:px-8 py-5 whitespace-nowrap">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        {inv.status === 'paid' ? (inv.paid_at ? t.invPaidOn(fmtDate(inv.paid_at)) : t.invPaid) : t.invDue}
                      </span>
                    </td>
                    <td className="px-6 lg:px-8 py-5 text-right">
                      {inv.file_url ? (
                        <a href={inv.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 hover:underline">
                          <Download size={14} /> {t.invDownload}
                        </a>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

type PortalView = 'overview' | 'board' | 'timeline' | 'hours' | 'invoices'

// Sign-in link that returns the visitor to the page they came for (email links)
const loginHref = () => `/portal/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`

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
  const [view, setView] = useState<PortalView>('overview')
  const [crTask, setCrTask] = useState<PortalTask | null>(null)
  // Set when the admin opened this page through a preview link
  const [preview, setPreview] = useState<string | null>(null)
  const [savedLang, setSavedLang] = useState<PortalLang>('en')
  // Task an email link points at (?task=…): shown with a ring on the board
  const [focusTask, setFocusTask] = useState<string | null>(null)
  // The task the client opened to read
  const [openTask, setOpenTask] = useState<string | null>(null)

  const refetch = useCallback(async (accessToken: string) => {
    const res = await fetch(`/api/portal/project/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 401) { router.replace(loginHref()); return }
    if (!res.ok) { setDenied(true); setLoading(false); return }
    setData(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    ;(async () => {
      try { setSavedLang(portalLang(localStorage.getItem(LANG_KEY))) } catch { /* storage unavailable */ }
      const params = new URLSearchParams(window.location.search)
      // Links from emails: ?chat=1 opens the chat, ?view=board&task=… the task
      const wantView = params.get('view')
      if (wantView === 'board' || wantView === 'timeline' || wantView === 'hours' || wantView === 'invoices') setView(wantView)
      if (params.get('task')) { setFocusTask(params.get('task')); setOpenTask(params.get('task')); setView('board') }
      if (params.get('chat')) setChatOpen(true)
      // ?notes=1: a document sent for review opens the project notes
      else if (params.get('notes')) setNotesOpen(true)
      const previewToken = params.get('preview')
      if (previewToken) {
        setPreview(previewToken)
        setToken(previewToken)
        refetch(previewToken)
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace(loginHref()); return }
      setToken(session.access_token)
      refetch(session.access_token)
    })()
  }, [id, router, refetch])

  // Bring the task from the email into view once the board is on screen
  useEffect(() => {
    if (!focusTask || !data || view !== 'board') return
    const el = document.getElementById(`task-${focusTask}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [focusTask, data, view])

  const lang: PortalLang = data ? portalLang(data.lang) : savedLang
  const t = PORTAL_TEXT[lang]

  useEffect(() => {
    if (data && !preview) { try { localStorage.setItem(LANG_KEY, portalLang(data.lang)) } catch { /* storage unavailable */ } }
  }, [data, preview])

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center text-gray-400 text-sm">{t.loading}</div>
  )

  if (denied || !data) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-gray-900 text-lg font-medium">{t.noAccess}</p>
        <Link href="/portal" className="text-sm text-gray-500 hover:text-gray-900 mt-3 inline-block underline">{t.backToProjects}</Link>
      </div>
    </div>
  )

  const { project, columns, assigneesByTask, timeByTask, changeRequests } = data
  const estimating = data.tasks.filter(isEstimatePending)
  const tasks = data.tasks.filter(x => !isEstimatePending(x))
  const sym = CURRENCY_SYMBOL[project.contract_currency ?? 'USD']
  const homeHref = preview ? `/portal?preview=${encodeURIComponent(preview)}` : '/portal'
  const lastColumnId = columns.length > 0 ? columns[columns.length - 1].id : null
  const doneTaskIds = new Set(tasks.filter(x => x.column_id === lastColumnId).map(x => x.id))
  const crLimit = project.change_request_limit ?? 3
  const crCountByTask: Record<string, number> = {}
  for (const cr of changeRequests ?? []) {
    crCountByTask[cr.task_id] = (crCountByTask[cr.task_id] ?? 0) + 1
  }
  const locale = portalLocale(lang)
  const tabs: { key: PortalView; label: string }[] = [
    { key: 'overview', label: t.overview },
    { key: 'board', label: t.board },
    { key: 'timeline', label: t.timeline },
    // Only when the team shows tracked hours to the client
    ...(data.timeByDay ? [{ key: 'hours' as const, label: t.trackedHours }] : []),
    { key: 'invoices', label: t.invoices },
  ]
  const ghost = 'flex items-center gap-2 border border-gray-200 hover:border-gray-900 text-gray-700 hover:text-gray-900 px-4 py-2 rounded-full text-sm font-medium transition-colors'

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {preview && <PortalPreviewBanner text="Режим перегляду — так цей проєкт бачить клієнт. Надсилання повідомлень, задач і нотаток тут вимкнене." />}
      <PortalHeader label={t.workspace} backHref={homeHref} />

      {/* Project head: name, actions, sections */}
      <div className="px-5 sm:px-8 lg:px-12 pt-8 border-b border-gray-100">
        <div className="flex items-end justify-between gap-x-6 gap-y-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color ?? '#2affaa' }} />
            <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight truncate">{project.name}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!preview && (
              <button onClick={() => setAddTaskOpen(true)} className={ghost} title={t.addTaskHint}>
                <Plus size={15} /> {t.addTask}
              </button>
            )}
            <button onClick={() => { setChatOpen(false); setNotesOpen(v => !v) }} className={ghost}>
              <NotebookPen size={15} /> {t.notes}
            </button>
            <button
              onClick={() => { setNotesOpen(false); setChatOpen(v => !v) }}
              className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors"
            >
              <MessageSquare size={15} /> {t.messageTeam}
            </button>
          </div>
        </div>
        <nav className="flex items-center gap-7 mt-7 -mb-px overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`pb-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                view === tab.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {view === 'timeline' ? (
        <div className="px-5 sm:px-8 lg:px-12 py-8">
          <div className="border border-gray-100 rounded-3xl overflow-hidden min-h-[480px] h-[calc(100vh-19rem)] flex flex-col">
          <GanttView
            tasks={tasks}
            onUpdate={() => {}}
            readOnly
            phases={data.phases ?? []}
            projectStart={project.start_date ?? null}
            deadline={project.deadline ?? null}
            doneIds={doneTaskIds}
            lang={lang}
          />
          </div>
        </div>
      ) : view === 'overview' ? (
        <OverviewDashboard
          data={data}
          sym={sym}
          t={t}
          lang={lang}
          onOpenBoard={() => setView('board')}
          onOpenChat={() => { setNotesOpen(false); setChatOpen(true) }}
        />
      ) : view === 'hours' && data.timeByDay ? (
        <PortalHours
          days={data.timeByDay}
          titles={Object.fromEntries(data.tasks.map(x => [x.id, x.title]))}
          t={t}
          lang={lang}
        />
      ) : view === 'invoices' ? (
        token && <PortalInvoices projectId={project.id} token={token} t={t} lang={lang} />
      ) : (
        <div className="px-5 sm:px-8 lg:px-12 py-8">
          {/* The board fills the screen: columns share the width */}
          <div className="flex gap-5 overflow-x-auto pb-4">
            {/* Tasks you asked for that are still being estimated; hidden when empty */}
            {estimating.length > 0 && (
              <div className="flex-1 min-w-[280px] max-w-[420px] flex flex-col">
                <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-gray-100">
                  <span className="w-2 h-2 rounded-full bg-violet-600" />
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 truncate">{t.estColumn}</span>
                  <span className="text-xs text-gray-300 tabular-nums ml-auto">{estimating.length}</span>
                </div>
                <div className="flex flex-col gap-3">
                  {estimating.map(task => (
                    <EstimateCard
                      key={task.id}
                      task={task}
                      projectId={project.id}
                      token={token}
                      readOnly={!!preview}
                      focused={task.id === focusTask}
                      sym={sym}
                      t={t}
                      onDecided={() => { if (token) refetch(token) }}
                    />
                  ))}
                </div>
              </div>
            )}
            {columns.map(col => {
              const colTasks = tasks.filter(x => x.column_id === col.id)
              return (
                <div key={col.id} className="flex-1 min-w-[250px] flex flex-col">
                  <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-gray-100">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 truncate">{col.name}</span>
                    <span className="text-xs text-gray-300 tabular-nums ml-auto">{colTasks.length}</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {colTasks.map(task => {
                      const names = assigneesByTask[task.id] ?? []
                      const secs = timeByTask?.[task.id]
                      const used = crCountByTask[task.id] ?? 0
                      return (
                        <div
                          key={task.id}
                          id={`task-${task.id}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${t.tdOpen}: ${task.title}`}
                          onClick={() => setOpenTask(task.id)}
                          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpenTask(task.id) } }}
                          className={`border rounded-2xl p-4 bg-white transition-shadow cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${task.id === focusTask ? 'border-[#2affaa] shadow-[0_0_0_4px_rgba(42,255,170,0.25)]' : 'border-gray-100'}`}
                        >
                          <p className="text-[15px] text-gray-900 leading-snug font-medium">{task.title}</p>
                          {task.description && <p className="text-sm text-gray-400 mt-1.5 line-clamp-2">{task.description}</p>}
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-3 text-xs">
                            {names.length > 0 && <span className="text-gray-500">{names.join(', ')}</span>}
                            {task.due_date && (
                              <span className="flex items-center gap-1 text-gray-400">
                                <Calendar size={12} />
                                {new Date(task.due_date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                            <span className="flex items-center gap-1 font-medium" style={{ color: PRIORITY_COLOR[task.priority ?? 'medium'] }}>
                              <Flag size={12} /> {t.priority[task.priority ?? 'medium']}
                            </span>
                            {timeByTask && secs != null && secs > 0 && (
                              <span className="flex items-center gap-1 text-gray-600 font-medium"><Clock size={12} /> {formatHours(secs, lang)}</span>
                            )}
                            {data.billing?.amountByTask[task.id] != null && (
                              <span className="text-gray-900 font-semibold tabular-nums" title={`${money(sym, data.billing.rate)}${t.estPerHour}`}>
                                {money(sym, data.billing.amountByTask[task.id])}
                              </span>
                            )}
                          </div>
                          {!preview && (
                            <button
                              onClick={e => { e.stopPropagation(); setCrTask(task) }}
                              onKeyDown={e => e.stopPropagation()}
                              disabled={used >= crLimit}
                              className="mt-3.5 w-full flex items-center justify-center gap-1.5 text-xs font-medium border border-gray-200 rounded-full py-2 text-gray-600 hover:text-gray-900 hover:border-gray-900 disabled:opacity-40 disabled:hover:text-gray-600 disabled:hover:border-gray-200 transition-colors"
                              title={used >= crLimit ? t.crLimit : t.crTitle}
                            >
                              <FilePen size={12} /> {t.requestChanges} ({used}/{crLimit})
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {colTasks.length === 0 && <p className="text-sm text-gray-300 py-2">{t.noTasks}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* A task opened by the client: read only */}
      {(() => {
        const task = openTask ? data.tasks.find(x => x.id === openTask) : null
        if (!task) return null
        const col = columns.find(c => c.id === task.column_id)
        const used = crCountByTask[task.id] ?? 0
        const amount = data.billing?.amountByTask[task.id]
        return (
          <PortalTaskDrawer
            task={task}
            column={col ? { name: col.name, color: col.color } : null}
            people={assigneesByTask[task.id] ?? []}
            seconds={timeByTask ? timeByTask[task.id] ?? 0 : null}
            amount={amount != null ? money(sym, amount) : null}
            money={n => money(sym, n)}
            subtasks={data.subtasksByTask?.[task.id] ?? []}
            requests={(changeRequests ?? []).filter(c => c.task_id === task.id)}
            t={t}
            lang={lang}
            canRequest={!preview && used < crLimit}
            requestLabel={`${t.requestChanges} (${used}/${crLimit})`}
            onRequestChanges={() => { setOpenTask(null); setCrTask(task) }}
            onClose={() => setOpenTask(null)}
          />
        )
      })()}

      {crTask && token && (
        <ChangeRequestModal
          projectId={project.id}
          task={crTask}
          token={token}
          used={crCountByTask[crTask.id] ?? 0}
          limit={crLimit}
          t={t}
          onClose={() => setCrTask(null)}
          onSubmitted={() => { setCrTask(null); refetch(token) }}
        />
      )}

      {chatOpen && token && (
        <PortalChat
          projectId={project.id}
          token={token}
          people={data.people ?? []}
          t={t}
          lang={lang}
          onClose={() => setChatOpen(false)}
        />
      )}

      {notesOpen && token && (
        <ProjectNotepad
          projectId={project.id}
          viewer={{ type: 'client', name: '' }}
          portalToken={token}
          lang={lang}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {addTaskOpen && token && (
        <AddTaskModal
          projectId={project.id}
          token={token}
          t={t}
          onClose={() => setAddTaskOpen(false)}
          onCreated={() => { setAddTaskOpen(false); refetch(token) }}
        />
      )}
    </div>
  )
}

// ── Client adds a task (goes to the Backlog only) ──────────────────────────────

function AddTaskModal({ projectId, token, t, onClose, onCreated }: {
  projectId: string
  token: string
  t: PortalText
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const name = title.trim()
    if (!name || saving) return
    setSaving(true)
    setError('')
    const res = await fetch(`/api/portal/project/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: name, description: desc.trim() }),
    })
    setSaving(false)
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: t.somethingWrong }))
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
            <h2 className="text-base font-semibold text-gray-900">{t.addTaskTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t.addTaskSub}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.fieldTitle} *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder={t.fieldTitlePh}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.fieldDetails}</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              placeholder={t.fieldDetailsPh}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              {t.cancel}
            </button>
            <button
              onClick={submit}
              disabled={saving || !title.trim()}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? t.adding : t.addToBacklog}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Change request modal ───────────────────────────────────────────────────────

function ChangeRequestModal({ projectId, task, token, used, limit, t, onClose, onSubmitted }: {
  projectId: string
  task: PortalTask
  token: string
  t: PortalText
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
      if (fileTooBig(f)) { setError(t.tooBig(f.name, MAX_FILE_MB)); return }
    }
    setError('')
    setFiles(prev => [...prev, ...picked].slice(0, 5))
  }

  async function submit() {
    if ((!content.trim() && files.length === 0) || saving) return
    setSaving(true)
    setError('')
    // Upload straight to storage from the browser — API routes on Vercel
    // reject bodies over ~4.5MB, so files can't travel through them
    const uploaded: { url: string; name: string }[] = []
    for (const f of files) {
      const path = `cr/${safeStoragePath(projectId, f.name)}`
      const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f, {
        contentType: f.type || 'application/octet-stream',
      })
      if (upErr) {
        setSaving(false)
        setError(t.uploadFailed(f.name, upErr.message))
        return
      }
      const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
      uploaded.push({ url: pub.publicUrl, name: f.name })
    }
    const res = await fetch(`/api/portal/project/${projectId}/change-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ taskId: task.id, content: content.trim(), files: uploaded }),
    })
    setSaving(false)
    if (res.ok) {
      onSubmitted()
    } else {
      const { error: err } = await res.json().catch(() => ({ error: t.somethingWrong }))
      setError(err)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t.requestChanges}</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-sm">
              «{task.title}» · {t.crOf(used + 1, limit)}
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
            placeholder={t.crPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none leading-relaxed"
          />

          {/* Files */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-teal-600 hover:text-teal-700 cursor-pointer w-fit">
              <Paperclip size={13} />
              {t.attach(MAX_FILE_MB)}
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
            {t.cancel}
          </button>
          <button
            onClick={submit}
            disabled={saving || (!content.trim() && files.length === 0)}
            className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? t.submitting : t.submitRequest}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Client-side chat (talks to the portal API only) ────────────────────────────

function PortalChat({ projectId, token, people, t, lang, onClose }: {
  projectId: string
  token: string
  people: string[]
  t: PortalText
  lang: PortalLang
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
  const [staged, setStaged] = useState<File[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const { width, startResize } = useChatWidth()

  // Typing indicator shares the channel with the team's client-channel chat
  const myName = messages.find(m => m.sender_type === 'client')?.sender_name ?? 'Client'
  const { typingNames, notifyTyping } = useTyping(`${projectId}:client`, myKey, myName)

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
        : [...(prev[messageId] ?? []), { message_id: messageId, emoji, reactor_key: myKey, reactor_name: t.you }],
    }))
    await fetch(`/api/portal/project/${projectId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId, emoji }),
    })
  }

  async function sendFile(f: File, withText = true) {
    setError('')
    if (fileTooBig(f)) { setError(t.fileTooBig(MAX_FILE_MB)); return }
    setUploading(true)
    // Direct-to-storage upload — Vercel API routes cap bodies at ~4.5MB
    const path = safeStoragePath(projectId, f.name)
    const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f, {
      contentType: f.type || 'application/octet-stream',
    })
    if (upErr) {
      setUploading(false)
      setError(t.uploadFailed(f.name, upErr.message))
      return
    }
    const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
    const res = await fetch(`/api/portal/project/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        content: withText ? input.trim() : '',
        fileUrl: pub.publicUrl,
        fileName: f.name,
      }),
    })
    setUploading(false)
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setInput('')
    } else {
      const { error: err } = await res.json().catch(() => ({ error: t.somethingWrong }))
      setError(err)
    }
  }

  async function sendFiles(fs: File[]) {
    for (let i = 0; i < fs.length; i++) await sendFile(fs[i], i === 0)
  }

  return (
    <DropZone
      onFiles={fs => setStaged(p => [...p, ...fs])}
      className="fixed right-0 top-0 h-full max-w-[100vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width }}
    >
      <ChatResizeHandle onMouseDown={startResize} />
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-teal-500" />
          <p className="text-sm font-semibold text-gray-800">{t.teamChat}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p className="text-xs text-gray-300 text-center mt-8">{t.chatEmpty}</p>
        )}
        {groupMessages(messages).map(item => {
          if (Array.isArray(item)) {
            const first = item[0]
            const gm = first.sender_type === 'client'
            return (
              <GalleryBubble
                key={first.id}
                images={item.map(x => ({ url: x.file_url as string, name: x.file_name ?? 'image' }))}
                mine={gm}
                senderName={!gm ? first.sender_name : undefined}
                timestamp={item[item.length - 1].created_at}
              />
            )
          }
          const m = item
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
                <div className={`min-w-0 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
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
                {new Date(m.created_at).toLocaleString(portalLocale(lang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="text-[11px] text-red-500 px-4 py-1.5 border-t border-red-100 bg-red-50 flex-shrink-0">{error}</p>
      )}

      <TypingLine names={typingNames} />
      <MentionComposer
        value={input}
        onChange={v => { setInput(v); notifyTyping() }}
        onSend={() => {
          if (staged.length > 0) {
            const fs = staged
            setStaged([])
            sendFiles(fs)
          } else send()
        }}
        onPickFile={f => setStaged(p => [...p, f])}
        onPickFiles={fs => setStaged(p => [...p, ...fs])}
        staged={staged}
        onUnstage={i => setStaged(p => p.filter((_, idx) => idx !== i))}
        people={people.map(name => ({ name, type: 'team' as const }))}
        placeholder={t.chatPlaceholder}
        uploading={uploading}
        accent="teal"
        onBookMeeting={() => setBookingOpen(true)}
      />

      {bookingOpen && <BookMeetingModal title={t.bookMeeting} onClose={() => setBookingOpen(false)} />}
    </DropZone>
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

function BookMeetingModal({ title, onClose }: { title: string; onClose: () => void }) {
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
            <p className="text-sm font-semibold text-gray-800">{title}</p>
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
