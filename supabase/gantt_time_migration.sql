-- Start date for Gantt chart
alter table pm_tasks add column if not exists start_date date;

-- Time tracking
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  created_at timestamptz default now()
);
alter table time_entries enable row level security;
drop policy if exists "time_entries_all" on time_entries;
create policy "time_entries_all" on time_entries for all using (true) with check (true);

-- Designer notifications: add recipient column to notifications table
alter table notifications add column if not exists recipient_team_member_id uuid references team_members(id) on delete cascade;
