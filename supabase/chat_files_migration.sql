-- Chat attachments: message file columns + public storage bucket
alter table project_messages add column if not exists file_url text;
alter table project_messages add column if not exists file_name text;

-- Bucket for chat uploads (public: file URLs are unguessable UUID paths)
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "chat_files_read" on storage.objects;
create policy "chat_files_read" on storage.objects
  for select using (bucket_id = 'chat-files');

drop policy if exists "chat_files_insert" on storage.objects;
create policy "chat_files_insert" on storage.objects
  for insert with check (bucket_id = 'chat-files');
