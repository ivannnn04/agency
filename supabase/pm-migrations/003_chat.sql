-- Chat messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  sender_id uuid references profiles(id),
  content text not null,
  is_ai boolean default false,
  created_at timestamptz default now()
);

-- Meeting recordings
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  title text,
  meet_link text,
  recording_url text,
  transcript text,
  summary text,
  action_items jsonb, -- [{title, assignee_id, due_date}]
  created_at timestamptz default now()
);

-- RLS
alter table public.messages enable row level security;
alter table public.meetings enable row level security;

create policy "Project members can view messages" on public.messages for select using (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);
create policy "Project members can send messages" on public.messages for insert with check (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);

create policy "Project members can view meetings" on public.meetings for select using (
  project_id in (
    select project_id from public.project_members where user_id = auth.uid()
  )
);
create policy "Authenticated can create meetings" on public.meetings for insert with check (auth.uid() is not null);

-- Realtime
alter publication supabase_realtime add table public.messages;
