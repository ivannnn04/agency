-- Multiple assignees per task
create table if not exists task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  created_at timestamptz default now(),
  unique(task_id, team_member_id)
);
alter table task_assignees enable row level security;
drop policy if exists "task_assignees_all" on task_assignees;
create policy "task_assignees_all" on task_assignees for all using (true) with check (true);

-- Backfill from existing single assignments
insert into task_assignees (task_id, team_member_id)
select id, team_member_id from pm_tasks
where team_member_id is not null
on conflict do nothing;
