-- Files attached to a task (any type). The file itself lives in the
-- existing public "chat-files" storage bucket; this table lists them.
create table if not exists task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  project_id uuid,
  file_name text not null,
  file_url text not null,
  storage_path text,
  file_size bigint,
  mime_type text,
  uploaded_by text,
  created_at timestamptz default now()
);
create index if not exists task_files_task_idx on task_files (task_id, created_at);
alter table task_files enable row level security;
drop policy if exists "task_files_all" on task_files;
create policy "task_files_all" on task_files for all using (true) with check (true);

-- Removing an attachment also removes the stored file
drop policy if exists "chat_files_delete" on storage.objects;
create policy "chat_files_delete" on storage.objects
  for delete using (bucket_id = 'chat-files');
