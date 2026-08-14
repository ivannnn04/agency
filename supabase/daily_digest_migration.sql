-- Daily AI digest drafts: the bot drafts a morning client update,
-- the admin reviews it in the team chat and approves/edits/dismisses it.
create table if not exists daily_digests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  draft text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists daily_digests_project_idx on daily_digests(project_id, status);
alter table daily_digests enable row level security;
drop policy if exists "daily_digests_all" on daily_digests;
create policy "daily_digests_all" on daily_digests for all using (true) with check (true);

-- Allow the bot ("Gudrix AI") to post messages in project chats
alter table project_messages drop constraint if exists project_messages_sender_type_check;
alter table project_messages
  add constraint project_messages_sender_type_check
  check (sender_type in ('admin', 'team', 'client', 'bot'));
