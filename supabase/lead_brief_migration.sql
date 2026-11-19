-- Design brief ("technical task") generated for a lead from its calls and
-- correspondence. Confidential like the rest of the lead AI data: RLS on,
-- no policies, read only through the admin API.
create table if not exists lead_briefs (
  lead_id uuid primary key references crm_leads(id) on delete cascade,
  content text not null,
  lang text not null default 'en',
  generated_at timestamptz not null default now()
);
alter table lead_briefs enable row level security;
