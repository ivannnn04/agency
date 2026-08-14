-- ── Client portal: accounts, project access, chat ──────────────────────────────

-- Clients (linked to Supabase Auth by email; auth_user_id filled on first login)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  auth_user_id uuid,
  created_at timestamptz default now()
);
alter table clients enable row level security;
drop policy if exists "clients_all" on clients;
create policy "clients_all" on clients for all using (true) with check (true);

-- Which client can see which project
create table if not exists project_clients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz default now(),
  unique(project_id, client_id)
);
alter table project_clients enable row level security;
drop policy if exists "project_clients_all" on project_clients;
create policy "project_clients_all" on project_clients for all using (true) with check (true);

-- Per-project toggle: show tracked hours to the client
alter table projects add column if not exists show_tracked_hours boolean not null default false;

-- Project chat: 'team' channel (team + admin) and 'client' channel (client + team + admin)
create table if not exists project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  channel text not null default 'team' check (channel in ('team', 'client')),
  sender_type text not null check (sender_type in ('admin', 'team', 'client')),
  sender_name text not null,
  team_member_id uuid references team_members(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists project_messages_project_channel_idx
  on project_messages(project_id, channel, created_at);
alter table project_messages enable row level security;
drop policy if exists "project_messages_all" on project_messages;
create policy "project_messages_all" on project_messages for all using (true) with check (true);
