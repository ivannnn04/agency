-- The admin's own tracked time on tasks. Kept apart from the team's
-- time_entries on purpose: it never reaches payroll or team workload.
create table if not exists admin_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  project_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  created_at timestamptz default now()
);
create index if not exists admin_time_entries_task_idx on admin_time_entries (task_id);
create index if not exists admin_time_entries_project_idx on admin_time_entries (project_id, started_at);
-- Admin-only data: no policies, so only the server (service role) reads and writes it
alter table admin_time_entries enable row level security;

-- Per task: does the admin's time on it go on the client's invoice
alter table pm_tasks add column if not exists admin_time_billable boolean not null default false;

-- The admin can take a task themselves (stores their display name)
alter table pm_tasks add column if not exists admin_assignee text;
