import supabaseAdmin from '@/lib/supabaseAdmin'
import { isInvoiceColumn } from '@/lib/clientColumns'

// Money behind the tracked hours, as the client sees it: the project's hourly
// rate, an amount per task, the value of all work tracked so far and what is
// still waiting to be paid. Shown only when the admin turns amounts on for
// the project (on top of showing hours).

export const BILLING_MIGRATION_HINT = 'Запусти міграцію supabase/client_billing_migration.sql у Supabase SQL Editor'

const round2 = (n: number) => Math.round(n * 100) / 100

interface ProjectSettings { client_hourly_rate?: number | string | null; show_tracked_amounts?: boolean | null; contract_currency?: string | null }

// The rate a project is billed at: set on the project, else the rate used on
// its latest estimate
export async function projectRate(projectId: string, settings?: ProjectSettings | null): Promise<number | null> {
  const own = Number(settings?.client_hourly_rate)
  if (own > 0) return own
  const { data } = await supabaseAdmin
    .from('pm_tasks').select('*').eq('finance_project_id', projectId).order('created_at', { ascending: false }).limit(200)
  const hit = ((data ?? []) as { estimate_rate?: number | null }[]).find(t => Number(t.estimate_rate) > 0)
  return hit ? Number(hit.estimate_rate) : null
}

export interface BillingTask {
  id: string
  column_id: string | null
  invoice_amount?: number | string | null
  estimate_status?: string | null
  estimate_cost?: number | string | null
  invoiced_at?: string | null
}

// One task's amount. Work in progress counts its tracked hours × rate, never
// above an agreed estimate. Delivered work (in "To be invoiced", or invoiced)
// counts what it is billed at: the manual amount, else the agreed estimate,
// else hours × rate — the same rule as the invoice report.
export function taskAmount(t: BillingTask, seconds: number, rate: number | null, delivered: boolean): number | null {
  const byHours = rate && seconds > 0 ? round2((seconds / 3600) * rate) : null
  const agreed = t.estimate_status === 'approved' && Number(t.estimate_cost) > 0 ? Number(t.estimate_cost) : null
  if (delivered) {
    if (t.invoice_amount != null && t.invoice_amount !== '') return round2(Number(t.invoice_amount))
    return agreed ?? byHours
  }
  if (byHours == null) return null
  return agreed != null ? Math.min(byHours, agreed) : byHours
}

export interface ClientBilling {
  rate: number
  currency: string
  amountByTask: Record<string, number>
  tracked_total: number
  pending: { not_invoiced: number; invoiced_unpaid: number; total: number }
}

export async function clientBilling(o: {
  projectId: string
  settings: ProjectSettings | null
  columns: { id: string; name: string }[]
  timeByTask: Record<string, number>
}): Promise<ClientBilling | null> {
  // The client sees amounts only when the admin turned them on
  if (!o.settings?.show_tracked_amounts) return null
  return computeBilling(o)
}

// The same numbers for the admin's own report, whatever the client is shown
export async function computeBilling(o: {
  projectId: string
  settings: ProjectSettings | null
  columns: { id: string; name: string }[]
  timeByTask: Record<string, number>
}): Promise<ClientBilling | null> {
  const rate = await projectRate(o.projectId, o.settings)
  if (!rate) return null
  const currency = o.settings?.contract_currency || 'USD'

  const [{ data: taskRows }, { data: invoices }] = await Promise.all([
    supabaseAdmin.from('pm_tasks').select('*').eq('finance_project_id', o.projectId),
    supabaseAdmin.from('project_invoices').select('amount, currency, status').eq('project_id', o.projectId),
  ])
  const invoiceCols = new Set(o.columns.filter(c => isInvoiceColumn(c.name)).map(c => c.id))

  const amountByTask: Record<string, number> = {}
  let tracked = 0, notInvoiced = 0
  for (const t of (taskRows ?? []) as BillingTask[]) {
    if (!t.column_id) continue // still being estimated: not part of the work yet
    const delivered = !!t.invoiced_at || invoiceCols.has(t.column_id)
    const amount = taskAmount(t, o.timeByTask[t.id] ?? 0, rate, delivered)
    if (amount == null || amount <= 0) continue
    amountByTask[t.id] = amount
    tracked += amount
    if (!t.invoiced_at) notInvoiced += amount
  }
  const invoicedUnpaid = ((invoices ?? []) as { amount: number | string | null; currency: string | null; status: string }[])
    .filter(i => i.status === 'to_be_paid' && (i.currency || 'USD') === currency)
    .reduce((s, i) => s + Number(i.amount ?? 0), 0)

  return {
    rate,
    currency,
    amountByTask,
    tracked_total: round2(tracked),
    pending: { not_invoiced: round2(notInvoiced), invoiced_unpaid: round2(invoicedUnpaid), total: round2(notInvoiced + invoicedUnpaid) },
  }
}
