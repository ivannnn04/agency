-- Global hourly rate per team member (USD)
alter table team_members add column if not exists hourly_rate_usd numeric default 0;

-- Monthly salary payments per designer
create table if not exists salary_payments (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,
  period_month date not null,             -- always the 1st of the month
  total_seconds int not null default 0,
  amount_usd numeric not null default 0,
  status text not null default 'confirmed',  -- 'confirmed' | 'paid'
  confirmed_at timestamptz default now(),
  paid_at timestamptz,
  account_id uuid references accounts(id) on delete set null,
  created_at timestamptz default now(),
  unique(team_member_id, period_month)
);
alter table salary_payments enable row level security;
drop policy if exists "salary_payments_all" on salary_payments;
create policy "salary_payments_all" on salary_payments for all using (true) with check (true);
