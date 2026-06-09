-- Profiles (extends Supabase Auth)
create table public.profiles (
  id uuid references auth.users primary key,
  full_name text not null,
  avatar_url text,
  role text default 'member', -- 'admin' | 'member'
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  color text default '#534AB7',
  status text default 'active', -- 'active' | 'paused' | 'done'
  owner_id uuid references profiles(id),
  created_at timestamptz default now()
);

-- Project members
create table public.project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "Users can view all profiles" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Members can view projects" on public.projects for select using (
  id in (select project_id from public.project_members where user_id = auth.uid())
  or owner_id = auth.uid()
);
create policy "Authenticated can create projects" on public.projects for insert with check (auth.uid() = owner_id);
create policy "Owners can update projects" on public.projects for update using (owner_id = auth.uid());
create policy "Owners can delete projects" on public.projects for delete using (owner_id = auth.uid());

create policy "Members can view memberships" on public.project_members for select using (true);
create policy "Owners can manage members" on public.project_members for all using (
  project_id in (select id from public.projects where owner_id = auth.uid())
);
