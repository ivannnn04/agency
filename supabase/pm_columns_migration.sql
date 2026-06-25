-- Run this once in Supabase SQL editor
-- Adds custom kanban columns support to PM boards

create table if not exists pm_columns (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references pm_projects(id) on delete cascade,
  name       text not null,
  color      text not null default '#6B7280',
  position   int  not null default 0,
  created_at timestamptz default now()
);

alter table pm_tasks
  add column if not exists column_id uuid references pm_columns(id) on delete set null;

-- RLS: allow authenticated users full access
alter table pm_columns enable row level security;

drop policy if exists "pm_columns_all" on pm_columns;
create policy "pm_columns_all" on pm_columns
  for all using (true) with check (true);
