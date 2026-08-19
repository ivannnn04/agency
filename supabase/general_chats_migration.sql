-- General team chats that live outside projects.
create table if not exists general_chats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
alter table general_chats enable row level security;
drop policy if exists "general_chats_all" on general_chats;
create policy "general_chats_all" on general_chats for all using (true) with check (true);

-- Chat messages may now belong to a general chat instead of a project
alter table project_messages alter column project_id drop not null;
alter table project_messages add column if not exists chat_id uuid references general_chats(id) on delete cascade;
create index if not exists project_messages_chat_idx on project_messages(chat_id);

-- Reactions follow the same rule
alter table message_reactions alter column project_id drop not null;
alter table message_reactions add column if not exists chat_id uuid references general_chats(id) on delete cascade;
