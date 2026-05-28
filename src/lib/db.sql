-- Run this in Supabase SQL Editor

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('bank', 'cash', 'card', 'safe')),
  currency text not null check (currency in ('UAH', 'USD', 'EUR')),
  balance numeric(15,2) not null default 0,
  color text not null default '#14b8a6',
  icon text,
  created_at timestamptz default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('income', 'expense')),
  parent_id uuid references categories(id) on delete set null,
  color text,
  created_at timestamptz default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz default now()
);

create table counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table transactions (
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

create table budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(15,2) not null default 0,
  type text not null check (type in ('income', 'expense')),
  created_at timestamptz default now(),
  unique(category_id, year, month)
);

-- Function to update account balance
create or replace function update_account_balance(p_account_id uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  update accounts set balance = balance + p_delta where id = p_account_id;
end;
$$;

-- Default categories
insert into categories (name, type) values
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
  ('Видача позики', 'expense');
