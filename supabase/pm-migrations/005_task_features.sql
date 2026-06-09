-- Migrate existing statuses to new names
update pm_tasks set status = 'internal_review' where status = 'review';
update pm_tasks set status = 'completed'       where status = 'done';

-- Task comments
create table if not exists pm_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references pm_tasks(id) on delete cascade,
  user_id    uuid references profiles(id),
  content    text not null,
  created_at timestamptz default now()
);
alter table pm_task_comments enable row level security;

create policy "Project members can view comments" on pm_task_comments for select using (
  task_id in (
    select t.id from pm_tasks t
    join pm_project_members m on m.project_id = t.project_id
    where m.user_id = auth.uid()
  )
);
create policy "Project members can add comments" on pm_task_comments for insert with check (
  task_id in (
    select t.id from pm_tasks t
    join pm_project_members m on m.project_id = t.project_id
    where m.user_id = auth.uid()
  )
);
create policy "Users can delete own comments" on pm_task_comments for delete using (user_id = auth.uid());

-- Task attachments (metadata; files stored in Supabase Storage bucket "pm-attachments")
create table if not exists pm_task_attachments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references pm_tasks(id) on delete cascade,
  user_id    uuid references profiles(id),
  file_name  text not null,
  file_url   text not null,
  file_size  integer,
  mime_type  text,
  created_at timestamptz default now()
);
alter table pm_task_attachments enable row level security;

create policy "Project members can view attachments" on pm_task_attachments for select using (
  task_id in (
    select t.id from pm_tasks t
    join pm_project_members m on m.project_id = t.project_id
    where m.user_id = auth.uid()
  )
);
create policy "Project members can add attachments" on pm_task_attachments for insert with check (
  task_id in (
    select t.id from pm_tasks t
    join pm_project_members m on m.project_id = t.project_id
    where m.user_id = auth.uid()
  )
);
create policy "Users can delete own attachments" on pm_task_attachments for delete using (user_id = auth.uid());

-- Realtime for comments
alter publication supabase_realtime add table pm_task_comments;

-- Storage bucket for PM file attachments (run separately if needed)
insert into storage.buckets (id, name, public, file_size_limit)
values ('pm-attachments', 'pm-attachments', false, 52428800) -- 50 MB limit
on conflict (id) do nothing;

create policy "Authenticated users can upload PM files"
  on storage.objects for insert
  with check (bucket_id = 'pm-attachments' and auth.uid() is not null);

create policy "Authenticated users can view PM files"
  on storage.objects for select
  using (bucket_id = 'pm-attachments' and auth.uid() is not null);

create policy "Users can delete own PM files"
  on storage.objects for delete
  using (bucket_id = 'pm-attachments' and auth.uid() = owner);
