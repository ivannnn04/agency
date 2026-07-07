-- ============================================================
-- Повна міграція: уніфікація projects + pm_boards
-- Запускати один раз у Supabase SQL Editor
-- ============================================================

-- 1. Додати color до projects (для UI — кольорова крапка в сайдбарі)
alter table projects add column if not exists color text default '#14b8a6';

-- 2. Видалити стару pm_columns (якщо вже запускали попередню міграцію)
drop table if exists pm_columns cascade;

-- 3. Нова pm_columns — посилається на projects.id напряму
create table pm_columns (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name       text not null,
  color      text not null default '#6B7280',
  position   int  not null default 0,
  created_at timestamptz default now()
);

alter table pm_columns enable row level security;
drop policy if exists "pm_columns_all" on pm_columns;
create policy "pm_columns_all" on pm_columns
  for all using (true) with check (true);

-- 4. column_id на pm_tasks (посилається на нову pm_columns)
alter table pm_tasks add column if not exists column_id uuid references pm_columns(id) on delete set null;

-- 5. Перепідключити pm_tasks.project_id → projects.id
alter table pm_tasks drop constraint if exists pm_tasks_project_id_fkey;
alter table pm_tasks
  add constraint pm_tasks_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;

-- 6. created_by зробити nullable (задачі можуть створюватись з фін. панелі)
alter table pm_tasks alter column created_by drop not null;

-- RLS на pm_tasks (якщо ще не налаштовано)
alter table pm_tasks enable row level security;
drop policy if exists "pm_tasks_all" on pm_tasks;
create policy "pm_tasks_all" on pm_tasks
  for all using (true) with check (true);
