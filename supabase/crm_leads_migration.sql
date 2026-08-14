-- CRM sales pipeline leads (kanban), separate from the outreach `leads` table
create table if not exists crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  amount numeric(15,2),
  currency text not null default 'USD' check (currency in ('USD','EUR','UAH')),
  channel text,
  status text not null default 'new'
    check (status in ('new','contacted','negotiation','proposal','won','lost')),
  notes text,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table crm_leads enable row level security;
drop policy if exists "crm_leads_all" on crm_leads;
create policy "crm_leads_all" on crm_leads for all using (true) with check (true);

-- Emails linked to a CRM lead (sent from the app; `in` reserved for future inbound sync)
create table if not exists lead_emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  direction text not null default 'out' check (direction in ('out','in')),
  subject text,
  body text,
  to_email text,
  from_email text,
  sent_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table lead_emails enable row level security;
drop policy if exists "lead_emails_all" on lead_emails;
create policy "lead_emails_all" on lead_emails for all using (true) with check (true);
