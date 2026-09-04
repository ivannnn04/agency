-- Screen recordings (Loom-style): recorded in the admin app, shared by a
-- public link /r/<id> that anyone can watch.
create table if not exists screen_recordings (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Запис екрана',
  file_url text not null,
  duration_seconds int default 0,
  created_at timestamptz default now()
);
alter table screen_recordings enable row level security;
drop policy if exists "screen_recordings_all" on screen_recordings;
create policy "screen_recordings_all" on screen_recordings for all using (true) with check (true);
