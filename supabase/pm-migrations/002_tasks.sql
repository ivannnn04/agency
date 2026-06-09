-- Tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  description text,
  status text default 'todo', -- 'todo'|'in_progress'|'review'|'done'
  priority text default 'medium', -- 'low'|'medium'|'high'
  assignee_id uuid references profiles(id),
  due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Time tracking
create table public.time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  user_id uuid references profiles(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_s integer -- null while running
);

-- RLS
alter table public.tasks enable row level security;
alter table public.time_logs enable row level security;

create policy "Project members can view tasks" on public.tasks for select using (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);
create policy "Project members can create tasks" on public.tasks for insert with check (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);
create policy "Project members can update tasks" on public.tasks for update using (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);
create policy "Project members can delete tasks" on public.tasks for delete using (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);

create policy "Users can manage their own time logs" on public.time_logs for all using (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.tasks;
