-- Read receipts for chats: one row per (chat, person) with the moment they
-- last had the chat open. chat_key: '<project_id>:<channel>' | 'chat:<id>' | 'dm:<key>'
create table if not exists chat_reads (
  chat_key text not null,
  reader_key text not null,
  reader_name text,
  last_read_at timestamptz not null default now(),
  primary key (chat_key, reader_key)
);
alter table chat_reads enable row level security;
drop policy if exists "chat_reads_all" on chat_reads;
create policy "chat_reads_all" on chat_reads for all using (true) with check (true);
