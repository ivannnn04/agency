-- ClickUp-style docs for the admin: nested documents with rich-text HTML content
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Без назви',
  content text default '',
  parent_id uuid references documents(id) on delete cascade,
  sort int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists documents_parent_idx on documents (parent_id);
alter table documents enable row level security;
drop policy if exists "documents_all" on documents;
create policy "documents_all" on documents for all using (true) with check (true);
