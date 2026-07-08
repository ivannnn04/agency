-- Project members (which team members can access which projects)
create table if not exists project_members (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  created_at     timestamptz default now(),
  unique(project_id, team_member_id)
);
alter table project_members enable row level security;
drop policy if exists "project_members_all" on project_members;
create policy "project_members_all" on project_members
  for all using (true) with check (true);

-- Notifications for admin
create table if not exists notifications (
  id             uuid primary key default gen_random_uuid(),
  type           text not null default 'task_created',
  message        text not null,
  project_id     uuid references projects(id) on delete cascade,
  task_id        uuid references pm_tasks(id) on delete cascade,
  team_member_id uuid references team_members(id) on delete set null,
  read           boolean not null default false,
  created_at     timestamptz default now()
);
alter table notifications enable row level security;
drop policy if exists "notifications_all" on notifications;
create policy "notifications_all" on notifications
  for all using (true) with check (true);
