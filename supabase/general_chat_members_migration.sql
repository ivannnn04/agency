-- Optional membership for general chats.
-- No rows for a chat = the chat is visible to the whole team;
-- with rows, only the listed members (and the admin) see it.
create table if not exists general_chat_members (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references general_chats(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  created_at timestamptz default now(),
  unique(chat_id, team_member_id)
);
create index if not exists general_chat_members_chat_idx on general_chat_members(chat_id);
alter table general_chat_members enable row level security;
drop policy if exists "general_chat_members_all" on general_chat_members;
create policy "general_chat_members_all" on general_chat_members for all using (true) with check (true);
