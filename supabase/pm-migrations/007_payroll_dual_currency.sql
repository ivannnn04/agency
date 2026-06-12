-- Migration 007: Payroll dual-currency & partial payments

-- Add UAH amount + exchange rate to payroll items
alter table payroll_items
  add column if not exists amount_uah  numeric not null default 0,
  add column if not exists exchange_rate numeric not null default 41;

-- Add UAH total + exchange rate to payroll runs
alter table payroll_runs
  add column if not exists total_amount_uah  numeric not null default 0,
  add column if not exists exchange_rate      numeric not null default 41;

-- Partial payments table (one payment = one account debit, any amount/currency)
create table if not exists payroll_payments (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references payroll_runs(id) on delete cascade not null,
  account_id    uuid references accounts(id),
  amount        numeric not null,
  currency      text    not null default 'UAH',
  amount_usd    numeric not null default 0,
  amount_uah    numeric not null default 0,
  exchange_rate numeric not null default 41,
  created_at    timestamptz default now()
);

notify pgrst, 'reload schema';
