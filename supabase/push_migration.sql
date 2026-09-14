-- Web Push: one row per device subscription. user_key is 'admin' or
-- 'team-<id>'. Rows are written only through our API (service role) —
-- RLS with no policies keeps the anon key out.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz default now()
);
create index if not exists push_subscriptions_user_key_idx on push_subscriptions (user_key);
alter table push_subscriptions enable row level security;
