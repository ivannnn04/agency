-- Admin profile: photo, display name, custom status (login stays Google)
create table if not exists admin_profile (
  id text primary key,
  name text default 'Ivan',
  avatar_url text,
  status_emoji text,
  status_text text,
  updated_at timestamptz default now()
);
alter table admin_profile enable row level security;
drop policy if exists "admin_profile_all" on admin_profile;
create policy "admin_profile_all" on admin_profile for all using (true) with check (true);
insert into admin_profile (id) values ('main') on conflict do nothing;
