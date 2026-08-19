-- Invoices the admin shares with the client of a project.
-- Statuses: 'to_be_paid' (once shared) → 'paid' (set by admin).
create table if not exists project_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  amount numeric,
  currency text not null default 'USD',
  file_url text,
  file_name text,
  status text not null default 'to_be_paid' check (status in ('to_be_paid', 'paid')),
  created_at timestamptz default now(),
  paid_at timestamptz
);
create index if not exists project_invoices_project_idx on project_invoices(project_id, created_at);

-- Links to the finance transactions created when the invoice is marked paid
-- (income for the full amount + optional expense for the payment fee)
alter table project_invoices add column if not exists income_tx_id uuid;
alter table project_invoices add column if not exists fee_tx_id uuid;
alter table project_invoices enable row level security;
drop policy if exists "project_invoices_all" on project_invoices;
create policy "project_invoices_all" on project_invoices for all using (true) with check (true);
