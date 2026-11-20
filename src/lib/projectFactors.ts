// The scorecard behind a project's health score. Each factor is scored 0–100
// and contributes weight × score; the weights add up to 100.

export type ProjectFactorKey = 'schedule' | 'progress' | 'estimates' | 'planning' | 'client' | 'blockers'

export const PROJECT_FACTORS: { key: ProjectFactorKey; label: string; weight: number; asks: string }[] = [
  { key: 'schedule', label: 'Дедлайн', weight: 25, asks: 'Will the project finish by its deadline? Compare the forecast and the planned finish with the deadline, and count overdue tasks and late phases. With no deadline set this cannot score above 50.' },
  { key: 'progress', label: 'Прогрес проти часу', weight: 20, asks: 'Is the share of work done keeping up with the share of time elapsed?' },
  { key: 'estimates', label: 'Оцінки та години', weight: 15, asks: 'Are tracked hours staying within estimates? Look at overrun tasks and at work tracked without an estimate.' },
  { key: 'planning', label: 'Якість планування', weight: 15, asks: 'Do open tasks have start and end dates, estimates and an assignee, and is there a roadmap with phases?' },
  { key: 'client', label: 'Клієнт і комунікація', weight: 15, asks: 'Is the feedback loop with the client healthy: unanswered client messages, tasks waiting for feedback, open change requests, and the tone on calls.' },
  { key: 'blockers', label: 'Блокери', weight: 10, asks: 'Blocked tasks and dependencies that stall the work. 100 means nothing is blocked.' },
]

export interface ProjectFactorScore { key: ProjectFactorKey; score: number; evidence: string; gap: string }

export const projectFactorPoints = (f: ProjectFactorScore) => {
  const w = PROJECT_FACTORS.find(d => d.key === f.key)?.weight ?? 0
  return Math.round((w * f.score) / 10) / 10
}

export function healthFrom(factors: ProjectFactorScore[]): number {
  const total = factors.reduce((s, f) => s + (PROJECT_FACTORS.find(d => d.key === f.key)?.weight ?? 0) * f.score / 100, 0)
  return Math.max(0, Math.min(100, Math.round(total)))
}

export interface ProjectMetrics {
  today: string
  start_date: string | null
  deadline: string | null
  days_total: number | null
  days_left: number | null
  time_elapsed_pct: number | null
  tasks_total: number
  tasks_done: number
  progress_pct: number
  progress_hours_pct: number | null
  by_column: { name: string; count: number }[]
  overdue: { title: string; due_date: string; days_late: number; who: string }[]
  due_soon: { title: string; due_date: string; who: string }[]
  blocked: number
  waiting_feedback: number
  open_without_dates: number
  open_without_estimate: number
  open_without_assignee: number
  estimate_hours_total: number
  estimate_hours_remaining: number
  tracked_hours_total: number
  tracked_hours_14d: number
  overruns: { title: string; estimate: number; tracked: number }[]
  forecast_finish: string | null
  forecast_days_late: number | null
  forecast_note: string
  planned_finish: string | null
  phases: { title: string; start_date: string | null; end_date: string | null; done: boolean; late: boolean }[]
  contract: { amount: number; currency: string } | null
  received: Record<string, number>
  open_change_requests: number
  client_waiting_reply_days: number | null
  calls: number
  last_call_at: string | null
}
