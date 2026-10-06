-- Outreach: proposals the browser Claude agents submit on Dribbble/Behance.
-- Rows are written through /api/outreach (service role + API key).
create table if not exists outreach_proposals (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'other',          -- dribbble | behance | ...
  job_title text not null default '',
  job_url text,
  client_name text,
  budget text,
  cover_letter text default '',
  status text not null default 'sent',           -- sent | replied | won | lost
  notes text,
  sent_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists outreach_source_idx on outreach_proposals (source);
create index if not exists outreach_status_idx on outreach_proposals (status);
alter table outreach_proposals enable row level security;
drop policy if exists "outreach_all" on outreach_proposals;
create policy "outreach_all" on outreach_proposals for all using (true) with check (true);
-- Converted proposals keep a link to the CRM lead they became
alter table outreach_proposals add column if not exists lead_id uuid references crm_leads(id) on delete set null;
-- The client's reply, logged by the agent via PATCH /api/outreach
alter table outreach_proposals add column if not exists client_reply text;
alter table outreach_proposals add column if not exists replied_at timestamptz;

-- Full client dialog: every new message the agent sees gets its own row
-- (exact repeats are deduped by the API, so agents can re-send safely)
create table if not exists outreach_replies (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references outreach_proposals(id) on delete cascade,
  message text not null,
  created_at timestamptz default now()
);
create index if not exists outreach_replies_proposal_idx on outreach_replies (proposal_id);
alter table outreach_replies enable row level security;
drop policy if exists "outreach_replies_all" on outreach_replies;
create policy "outreach_replies_all" on outreach_replies for all using (true) with check (true);
