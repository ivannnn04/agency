-- Shared per-project notepad: admin, team and client all read and write.
create table if not exists project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_type text not null check (author_type in ('admin', 'team', 'client')),
  author_id text,
  author_name text not null,
  content text not null default '',
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists project_notes_project_idx on project_notes(project_id, created_at);
alter table project_notes enable row level security;
drop policy if exists "project_notes_all" on project_notes;
create policy "project_notes_all" on project_notes for all using (true) with check (true);
