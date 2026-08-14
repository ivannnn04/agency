-- Client change requests per task, with a per-project limit set by the admin
create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  client_name text,
  content text not null,
  files jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz default now()
);
create index if not exists change_requests_task_idx on change_requests(task_id);
alter table change_requests enable row level security;
drop policy if exists "change_requests_all" on change_requests;
create policy "change_requests_all" on change_requests for all using (true) with check (true);

-- How many change requests a client can submit per task (admin-configurable)
alter table projects add column if not exists change_request_limit int not null default 3;
