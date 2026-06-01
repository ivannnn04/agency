-- Run this in Supabase SQL Editor
-- If tables already exist, run the "drop" block first (optional)

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('bank', 'cash', 'card', 'safe')),
  currency text not null check (currency in ('UAH', 'USD', 'EUR')),
  balance numeric(15,2) not null default 0,
  color text not null default '#14b8a6',
  icon text,
  created_at timestamptz default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('income', 'expense')),
  parent_id uuid references categories(id) on delete set null,
  color text,
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  contract_amount numeric(15,2),
  contract_currency text default 'USD',
  received_before_app numeric(15,2) default 0,
  archived_at timestamptz,
  created_at timestamptz default now()
);
-- If projects table already exists, add new columns:
alter table projects add column if not exists contract_amount numeric(15,2);
alter table projects add column if not exists contract_currency text default 'USD';
alter table projects add column if not exists received_before_app numeric(15,2) default 0;
alter table projects add column if not exists spent_before_app numeric(15,2) default 0;
-- Update status check to allow 'archived':
alter table projects add column if not exists archived_at timestamptz;
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (status in ('active', 'inactive', 'archived'));

create table if not exists counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income', 'expense', 'transfer')),
  amount numeric(15,2) not null,
  currency text not null check (currency in ('UAH', 'USD', 'EUR')),
  account_id uuid not null references accounts(id) on delete cascade,
  to_account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  counterparty_id uuid references counterparties(id) on delete set null,
  date timestamptz not null default now(),
  comment text,
  document_url text,
  is_planned boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(15,2) not null default 0,
  type text not null check (type in ('income', 'expense')),
  created_at timestamptz default now(),
  unique(category_id, year, month)
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  project_id uuid references projects(id) on delete set null,
  amount numeric(15,2) not null,
  currency text not null check (currency in ('UAH', 'USD', 'EUR')),
  invoice_date date not null default current_date,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'overdue', 'paid')),
  account_id uuid references accounts(id) on delete set null,
  notes text,
  paid_amount numeric(15,2) not null default 0,
  paid_at timestamptz,
  transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz default now()
);
-- If invoices table already exists, add the column:
alter table invoices add column if not exists paid_amount numeric(15,2) not null default 0;

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate_usd numeric(8,2) not null default 0,
  created_at timestamptz default now()
);

create table if not exists employee_project_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  rate_usd numeric(8,2) not null,
  unique(employee_id, project_id)
);

create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  status text not null default 'draft' check (status in ('draft', 'paid')),
  total_amount numeric(15,2) not null default 0,
  currency text not null default 'USD',
  account_id uuid references accounts(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists payroll_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_name text not null,
  project_id uuid references projects(id) on delete set null,
  project_name_raw text,
  hours_decimal numeric(10,2) not null default 0,
  rate_usd numeric(8,2) not null,
  amount numeric(15,2) not null,
  transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz default now()
);

-- Disable Row Level Security so the anon key can read/write
alter table accounts disable row level security;
alter table categories disable row level security;
alter table projects disable row level security;
alter table counterparties disable row level security;
alter table transactions disable row level security;
alter table budgets disable row level security;
alter table invoices disable row level security;
alter table employees disable row level security;
alter table employee_project_rates disable row level security;
alter table payroll_runs disable row level security;
alter table payroll_items disable row level security;

-- Function to update account balance
create or replace function update_account_balance(p_account_id uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  update accounts set balance = balance + p_delta where id = p_account_id;
end;
$$;

-- Default categories (skip if already exist)
insert into categories (name, type)
select name, type from (values
  ('Оплата послуг', 'income'),
  ('Оплата за товар', 'income'),
  ('Повернення позики', 'income'),
  ('Отримання кредиту', 'income'),
  ('Зарплата', 'expense'),
  ('Оренда', 'expense'),
  ('Маркетинг', 'expense'),
  ('Матеріали', 'expense'),
  ('Адміністративні витрати', 'expense'),
  ('Податки', 'expense'),
  ('Видача позики', 'expense')
) as v(name, type)
where not exists (select 1 from categories limit 1);
