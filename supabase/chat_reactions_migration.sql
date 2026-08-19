-- Emoji reactions on chat messages (team + client channels)
create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references project_messages(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  emoji text not null,
  reactor_key text not null,  -- 'admin' | 'team:<member_id>' | 'client:<client_id>'
  reactor_name text,
  created_at timestamptz default now(),
  unique(message_id, emoji, reactor_key)
);
create index if not exists message_reactions_project_idx on message_reactions(project_id);
create index if not exists message_reactions_message_idx on message_reactions(message_id);
alter table message_reactions enable row level security;
drop policy if exists "message_reactions_all" on message_reactions;
create policy "message_reactions_all" on message_reactions for all using (true) with check (true);
