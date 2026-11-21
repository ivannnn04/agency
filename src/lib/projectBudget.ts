import supabaseAdmin from '@/lib/supabaseAdmin'

// A project's budget is a ledger: the starting contract plus every addition
// (a new stage sold, an approved client estimate). The sum is mirrored into
// projects.contract_amount, which analytics, receivables and the client
// workspace already read.

export interface BudgetItem {
  id: string
  kind: 'base' | 'addition' | 'estimate'
  title: string
  amount: number
  task_id: string | null
  created_at: string | null
}
export interface Budget { items: BudgetItem[]; total: number; currency: string; ledger: boolean }

const BASE_TITLE = 'Початковий бюджет'
const missing = (msg: string | undefined) => /project_budget_items|schema cache|does not exist/i.test(msg ?? '')
export const BUDGET_MIGRATION_HINT = 'Запусти міграцію supabase/project_budget_migration.sql у Supabase SQL Editor'

async function projectRow(projectId: string) {
  const { data } = await supabaseAdmin.from('projects').select('contract_amount, contract_currency').eq('id', projectId).maybeSingle()
  return { amount: Number(data?.contract_amount ?? 0), currency: (data?.contract_currency as string | null) ?? 'USD' }
}

async function rows(projectId: string): Promise<{ items: BudgetItem[]; ledger: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('project_budget_items')
    .select('id, kind, title, amount, task_id, created_at')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) return { items: [], ledger: !missing(error.message) }
  const items = ((data ?? []) as BudgetItem[]).map(i => ({ ...i, amount: Number(i.amount) }))
  // The starting budget always reads first
  return { items: [...items.filter(i => i.kind === 'base'), ...items.filter(i => i.kind !== 'base')], ledger: true }
}

export async function getBudget(projectId: string): Promise<Budget> {
  const [project, { items, ledger }] = await Promise.all([projectRow(projectId), rows(projectId)])
  if (items.length === 0) {
    // Nothing recorded yet: the whole current amount is the starting budget
    return {
      items: [{ id: 'base', kind: 'base', title: BASE_TITLE, amount: project.amount, task_id: null, created_at: null }],
      total: project.amount, currency: project.currency, ledger,
    }
  }
  return { items, total: items.reduce((s, i) => s + i.amount, 0), currency: project.currency, ledger }
}

// The first change turns the current amount into the ledger's base line
async function ensureBase(projectId: string): Promise<string | null> {
  const { items, ledger } = await rows(projectId)
  if (!ledger) return null
  const base = items.find(i => i.kind === 'base')
  if (base) return base.id
  const project = await projectRow(projectId)
  const already = items.reduce((s, i) => s + i.amount, 0)
  const { data } = await supabaseAdmin
    .from('project_budget_items')
    .insert({ project_id: projectId, kind: 'base', title: BASE_TITLE, amount: Math.max(0, project.amount - already) })
    .select('id')
    .single()
  return data?.id ?? null
}

async function syncTotal(projectId: string): Promise<number> {
  const { items } = await rows(projectId)
  const total = items.reduce((s, i) => s + i.amount, 0)
  await supabaseAdmin.from('projects').update({ contract_amount: total }).eq('id', projectId)
  return total
}

export async function setBase(projectId: string, amount: number): Promise<{ error?: string }> {
  const baseId = await ensureBase(projectId)
  if (!baseId) {
    // No ledger table yet: the budget is still a single number
    const { error } = await supabaseAdmin.from('projects').update({ contract_amount: amount }).eq('id', projectId)
    return error ? { error: error.message } : {}
  }
  const { error } = await supabaseAdmin.from('project_budget_items').update({ amount }).eq('id', baseId)
  if (error) return { error: error.message }
  await syncTotal(projectId)
  return {}
}

export async function addItem(projectId: string, o: { title: string; amount: number; kind?: 'addition' | 'estimate'; taskId?: string | null }): Promise<{ error?: string }> {
  const baseId = await ensureBase(projectId)
  if (!baseId) return { error: BUDGET_MIGRATION_HINT }
  const { error } = await supabaseAdmin.from('project_budget_items').insert({
    project_id: projectId, kind: o.kind ?? 'addition', title: o.title.slice(0, 200), amount: o.amount, task_id: o.taskId ?? null,
  })
  // The same task approved twice is one budget line, not two
  if (error && !/duplicate|unique/i.test(error.message)) return { error: error.message }
  await syncTotal(projectId)
  return {}
}

export async function updateItem(projectId: string, id: string, patch: { title?: string; amount?: number }): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('project_budget_items').update(patch).eq('id', id).eq('project_id', projectId)
  if (error) return { error: missing(error.message) ? BUDGET_MIGRATION_HINT : error.message }
  await syncTotal(projectId)
  return {}
}

export async function deleteItem(projectId: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('project_budget_items').delete().eq('id', id).eq('project_id', projectId).neq('kind', 'base')
  if (error) return { error: missing(error.message) ? BUDGET_MIGRATION_HINT : error.message }
  await syncTotal(projectId)
  return {}
}

// An approved estimate with a price extends the budget by that price
export async function addEstimateToBudget(taskId: string): Promise<{ added: number; error?: string }> {
  const { data: task } = await supabaseAdmin
    .from('pm_tasks')
    .select('id, title, finance_project_id, estimate_cost, estimate_status')
    .eq('id', taskId)
    .maybeSingle()
  const cost = Number(task?.estimate_cost ?? 0)
  if (!task?.finance_project_id || task.estimate_status !== 'approved' || !(cost > 0)) return { added: 0 }
  const r = await addItem(task.finance_project_id as string, { title: task.title, amount: cost, kind: 'estimate', taskId: task.id })
  return r.error ? { added: 0, error: r.error } : { added: cost }
}
