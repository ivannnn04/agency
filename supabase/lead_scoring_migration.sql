-- Fact-based lead qualification: the facts recorded on the lead card
-- (Crunchbase, company size, contact role, readiness to start, …).
alter table crm_leads add column if not exists qualification jsonb not null default '{}'::jsonb;
