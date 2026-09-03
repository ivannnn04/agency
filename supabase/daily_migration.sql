-- Personal "Мій день" page for the admin: habit tracking, daily to-dos, notes.

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#14b8a6',
  position int default 0,
  created_at timestamptz default now()
);
alter table habits enable row level security;
drop policy if exists "habits_all" on habits;
create policy "habits_all" on habits for all using (true) with check (true);

create table if not exists habit_checks (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  day date not null,
  created_at timestamptz default now(),
  unique(habit_id, day)
);
create index if not exists habit_checks_day_idx on habit_checks(day);
alter table habit_checks enable row level security;
drop policy if exists "habit_checks_all" on habit_checks;
create policy "habit_checks_all" on habit_checks for all using (true) with check (true);

create table if not exists daily_todos (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  title text not null,
  done boolean not null default false,
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists daily_todos_day_idx on daily_todos(day);
alter table daily_todos enable row level security;
drop policy if exists "daily_todos_all" on daily_todos;
create policy "daily_todos_all" on daily_todos for all using (true) with check (true);

create table if not exists personal_notes (
  id text primary key,
  content text default '',
  updated_at timestamptz default now()
);
alter table personal_notes enable row level security;
drop policy if exists "personal_notes_all" on personal_notes;
create policy "personal_notes_all" on personal_notes for all using (true) with check (true);
insert into personal_notes (id, content) values ('main', '') on conflict do nothing;
