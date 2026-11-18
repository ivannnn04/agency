-- Sales AI: a "room" per client/deal holding everything the live assistant
-- should know (brief, previous meeting transcripts, linked lead/project),
-- plus the transcripts and summaries of calls run through it.
--
-- Call transcripts are confidential, so RLS is ON with NO policies: only the
-- service role (the admin-only /api/sales-ai/* routes) can read or write.
create table if not exists sales_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  about text default '',
  language text default 'auto',
  lead_id uuid references crm_leads(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists sales_docs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references sales_rooms(id) on delete cascade,
  kind text not null default 'doc' check (kind in ('doc', 'meeting')),
  title text not null default '',
  content text default '',
  summary text,
  created_at timestamptz default now()
);
create index if not exists sales_docs_room_idx on sales_docs (room_id, created_at);

alter table sales_rooms enable row level security;
alter table sales_docs enable row level security;
