-- Team members table for designer/contractor access via token URL
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text not null default 'designer',
  color text not null default '#14b8a6',
  access_token text not null unique default gen_random_uuid()::text,
  created_at timestamptz default now()
);
alter table team_members enable row level security;
create policy "team_members_all" on team_members for all using (true) with check (true);

-- Add team_member_id to pm_tasks for assignment
alter table pm_tasks add column if not exists team_member_id uuid references team_members(id) on delete set null;
