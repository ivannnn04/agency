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
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz default now()
);

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

-- Disable Row Level Security so the anon key can read/write
alter table accounts disable row level security;
alter table categories disable row level security;
alter table projects disable row level security;
alter table counterparties disable row level security;
alter table transactions disable row level security;
alter table budgets disable row level security;
alter table invoices disable row level security;

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
