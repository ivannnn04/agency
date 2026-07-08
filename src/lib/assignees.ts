import { supabase } from '@/lib/supabase'

// Fetch all assignees for the given task ids into a map: taskId -> memberId[]
export async function fetchAssigneesByTask(taskIds: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  if (taskIds.length === 0) return map
  const { data } = await supabase
    .from('task_assignees')
    .select('task_id, team_member_id')
    .in('task_id', taskIds)
  for (const row of data ?? []) {
    if (!map[row.task_id]) map[row.task_id] = []
    map[row.task_id].push(row.team_member_id)
  }
  return map
}
