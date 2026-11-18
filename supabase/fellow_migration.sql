-- Fellow notetaker → CRM leads: synced meetings, AI deal overview, sync state.
-- All three tables hold confidential call content, so RLS is on with NO
-- policies: only the service-role API routes (admin-only) can read them.

create table if not exists lead_meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references crm_leads(id) on delete set null,
  source text not null default 'fellow',
  external_id text not null unique,
  note_id text,
  title text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  attendees jsonb not null default '[]'::jsonb,
  recap text,
  transcript text,
  match_reason text,
  ignored boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists lead_meetings_lead_idx on lead_meetings (lead_id, started_at);

create table if not exists lead_ai_overviews (
  lead_id uuid primary key references crm_leads(id) on delete cascade,
  data jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists integration_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table lead_meetings enable row level security;
alter table lead_ai_overviews enable row level security;
alter table integration_state enable row level security;

-- Extra card fields on the leads board
alter table crm_leads add column if not exists company text;
alter table crm_leads add column if not exists contact_name text;
