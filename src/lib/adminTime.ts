import supabaseAdmin from '@/lib/supabaseAdmin'

// The admin's own tracked time, as far as it concerns anyone else: only time
// on tasks marked "invoice my time" counts as billable work on the project —
// on the invoice report and in what the client sees as hours logged.
// Both helpers return nothing until the admin-time migration has been run.

export interface AdminEntry { task_id: string; started_at: string; duration_seconds: number | null }

// Finished billable entries; `since` limits them to recent work
export async function billableAdminEntries(taskIds: string[], since?: string): Promise<AdminEntry[]> {
  if (taskIds.length === 0) return []
  const { data: flagged, error } = await supabaseAdmin
    .from('pm_tasks').select('id').in('id', taskIds).eq('admin_time_billable', true)
  if (error || !flagged?.length) return []
  let q = supabaseAdmin
    .from('admin_time_entries')
    .select('task_id, started_at, duration_seconds')
    .in('task_id', flagged.map(t => t.id as string))
    .not('ended_at', 'is', null)
  if (since) q = q.gte('ended_at', since)
  const { data } = await q
  return (data ?? []) as AdminEntry[]
}

// Finished billable seconds per task
export async function billableAdminTime(taskIds: string[], since?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const e of await billableAdminEntries(taskIds, since)) {
    out[e.task_id] = (out[e.task_id] ?? 0) + (e.duration_seconds ?? 0)
  }
  return out
}

// Tasks the admin took themselves: task id → the admin's display name
export async function adminAssignees(taskIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (taskIds.length === 0) return out
  const { data, error } = await supabaseAdmin
    .from('pm_tasks').select('id, admin_assignee').in('id', taskIds).not('admin_assignee', 'is', null)
  if (error) return out
  for (const t of (data ?? []) as { id: string; admin_assignee: string | null }[]) {
    if (t.admin_assignee) out[t.id] = t.admin_assignee
  }
  return out
}
