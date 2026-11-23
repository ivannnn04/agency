import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'
import { isInvoiceColumn } from '@/lib/clientColumns'
import { billableAdminTime } from '@/lib/adminTime'

// "To be invoiced", month by month: every task sitting in a project's
// "To be invoiced" column, grouped by the month it got there, with tracked
// hours and the amount to bill. Admin-only — clients see these tasks as Done.

export const dynamic = 'force-dynamic'

const MIGRATION_HINT = 'Запусти міграцію supabase/invoicing_migration.sql у Supabase SQL Editor'
const monthOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7)

interface TaskRow {
  id: string
  title: string
  column_id: string | null
  finance_project_id: string | null
  created_at: string
  estimate_hours?: number | null
  estimate_rate?: number | null
  estimate_cost?: number | null
  to_invoice_at?: string | null
  invoice_amount?: number | null
  invoiced_at?: string | null
}

async function load() {
  const { data: allColumns } = await supabaseAdmin.from('pm_columns').select('id, name, project_id')
  const columns = (allColumns ?? []).filter(c => isInvoiceColumn(c.name))
  const columnIds = columns.map(c => c.id as string)
  if (columnIds.length === 0) return { tasks: [] as TaskRow[], projects: [], clientsByProject: new Map<string, string[]>(), secondsByTask: new Map<string, number>(), rateByProject: new Map<string, number>() }

  const { data: taskRows } = await supabaseAdmin.from('pm_tasks').select('*').in('column_id', columnIds)
  const tasks = (taskRows ?? []) as TaskRow[]
  const projectIds = [...new Set(tasks.map(t => t.finance_project_id).filter(Boolean))] as string[]
  const taskIds = tasks.map(t => t.id)

  const [{ data: projects }, { data: links }, { data: entries }, { data: rated }] = await Promise.all([
    projectIds.length ? supabaseAdmin.from('projects').select('id, name, color, contract_currency').in('id', projectIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabaseAdmin.from('project_clients').select('project_id, clients(name, email)').in('project_id', projectIds) : Promise.resolve({ data: [] }),
    taskIds.length ? supabaseAdmin.from('time_entries').select('task_id, duration_seconds').in('task_id', taskIds).not('ended_at', 'is', null) : Promise.resolve({ data: [] }),
    // The project's hourly rate: the one used on its latest estimate
    projectIds.length ? supabaseAdmin.from('pm_tasks').select('*').in('finance_project_id', projectIds).order('created_at') : Promise.resolve({ data: [] }),
  ])

  const clientsByProject = new Map<string, string[]>()
  for (const l of (links ?? []) as unknown as { project_id: string; clients: { name: string | null; email: string } | null }[]) {
    if (!l.clients) continue
    clientsByProject.set(l.project_id, [...(clientsByProject.get(l.project_id) ?? []), l.clients.name || l.clients.email])
  }
  const secondsByTask = new Map<string, number>()
  for (const e of (entries ?? []) as { task_id: string; duration_seconds: number | null }[]) {
    secondsByTask.set(e.task_id, (secondsByTask.get(e.task_id) ?? 0) + (e.duration_seconds ?? 0))
  }
  // The admin's own time counts on tasks where it is marked for invoicing
  for (const [taskId, seconds] of Object.entries(await billableAdminTime(tasks.map(t => t.id)))) {
    secondsByTask.set(taskId, (secondsByTask.get(taskId) ?? 0) + seconds)
  }
  const rateByProject = new Map<string, number>()
  for (const t of (rated ?? []) as TaskRow[]) {
    if (t.finance_project_id && Number(t.estimate_rate) > 0) rateByProject.set(t.finance_project_id, Number(t.estimate_rate))
  }
  return { tasks, projects: projects ?? [], clientsByProject, secondsByTask, rateByProject }
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const now = monthOf(new Date().toISOString())
  const month = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get('month') ?? '') ? req.nextUrl.searchParams.get('month')! : now

  const { tasks, projects, clientsByProject, secondsByTask, rateByProject } = await load()
  const withMonth = tasks.map(t => ({ t, month: monthOf(t.to_invoice_at ?? t.created_at) }))

  // Months that have anything, for the switcher
  const months = new Map<string, { open: number; invoiced: number }>()
  for (const { t, month: m } of withMonth) {
    const row = months.get(m) ?? { open: 0, invoiced: 0 }
    if (t.invoiced_at) row.invoiced++; else row.open++
    months.set(m, row)
  }

  const out = projects
    .map(p => {
      const rate = rateByProject.get(p.id as string) ?? null
      const lines = withMonth
        .filter(x => x.month === month && x.t.finance_project_id === p.id)
        .sort((a, b) => (a.t.to_invoice_at ?? a.t.created_at).localeCompare(b.t.to_invoice_at ?? b.t.created_at))
        .map(({ t }) => {
          const hours = Math.round(((secondsByTask.get(t.id) ?? 0) / 3600) * 100) / 100
          // What to bill: a manual amount, else the approved estimate, else tracked hours × the project's rate
          const byHours = rate && hours > 0 ? Math.round(hours * rate * 100) / 100 : null
          const amount = t.invoice_amount ?? t.estimate_cost ?? byHours
          const source = t.invoice_amount != null ? 'manual' : t.estimate_cost != null ? 'estimate' : byHours != null ? 'hours' : null
          return {
            id: t.id, title: t.title, ready_at: t.to_invoice_at ?? t.created_at,
            tracked_hours: hours, estimate_hours: t.estimate_hours ?? null,
            amount: amount != null ? Number(amount) : null, source,
            invoiced_at: t.invoiced_at ?? null,
          }
        })
      return {
        id: p.id, name: p.name, color: p.color, currency: p.contract_currency ?? 'USD', rate,
        clients: clientsByProject.get(p.id as string) ?? [],
        lines,
      }
    })
    .filter(p => p.lines.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))

  return NextResponse.json({
    month, current: now,
    months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, c]) => ({ month: m, ...c })),
    projects: out,
    // Without the migration the month a task became billable is unknown
    migrated: tasks.length === 0 || tasks.some(t => 'to_invoice_at' in t),
  })
}

// Set the amount to bill for one task (null returns to the automatic amount)
export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  const n = body.amount === null || body.amount === '' ? null : Number(body.amount)
  if (n !== null && !Number.isFinite(n)) return NextResponse.json({ error: 'Некоректна сума' }, { status: 400 })
  const { error } = await supabaseAdmin.from('pm_tasks').update({ invoice_amount: n }).eq('id', taskId)
  if (error) return NextResponse.json({ error: /invoice_amount|schema cache/i.test(error.message) ? MIGRATION_HINT : error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Mark a project's month as invoiced (optionally creating the invoice the
// client sees in their Invoices tab), or reopen it
export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const month = typeof body?.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : ''
  const action = body?.action === 'reopen' ? 'reopen' : body?.action === 'invoice' ? 'invoice' : null
  if (!projectId || !month || !action) return NextResponse.json({ error: 'projectId, month and action are required' }, { status: 400 })

  const { tasks, projects, secondsByTask, rateByProject } = await load()
  const mine = tasks.filter(t => t.finance_project_id === projectId && monthOf(t.to_invoice_at ?? t.created_at) === month)
  const fail = (msg: string) => NextResponse.json({ error: /invoiced_at|invoice_id|schema cache/i.test(msg) ? MIGRATION_HINT : msg }, { status: 400 })

  if (action === 'reopen') {
    const ids = mine.filter(t => t.invoiced_at).map(t => t.id)
    if (ids.length) {
      const { error } = await supabaseAdmin.from('pm_tasks').update({ invoiced_at: null, invoice_id: null }).in('id', ids)
      if (error) return fail(error.message)
    }
    return NextResponse.json({ ok: true, count: ids.length })
  }

  const open = mine.filter(t => !t.invoiced_at)
  if (open.length === 0) return NextResponse.json({ error: 'Немає задач до виставлення' }, { status: 400 })
  const rate = rateByProject.get(projectId) ?? null
  const amountOf = (t: TaskRow) => {
    const hours = (secondsByTask.get(t.id) ?? 0) / 3600
    return Number(t.invoice_amount ?? t.estimate_cost ?? (rate && hours > 0 ? Math.round(hours * rate * 100) / 100 : 0))
  }
  const total = Math.round(open.reduce((s, t) => s + amountOf(t), 0) * 100) / 100

  let invoiceId: string | null = null
  if (body.createInvoice) {
    const project = projects.find(p => p.id === projectId)
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : `Invoice — ${month}`
    const { data: inv, error } = await supabaseAdmin
      .from('project_invoices')
      .insert({ project_id: projectId, title, amount: total, currency: project?.contract_currency ?? 'USD', status: 'to_be_paid' })
      .select('id')
      .single()
    if (error || !inv) return fail(error?.message ?? 'Не вдалося створити інвойс')
    invoiceId = inv.id as string
  }
  const { error } = await supabaseAdmin
    .from('pm_tasks')
    .update({ invoiced_at: new Date().toISOString(), invoice_id: invoiceId })
    .in('id', open.map(t => t.id))
  if (error) return fail(error.message)
  return NextResponse.json({ ok: true, count: open.length, total, invoiceId })
}
