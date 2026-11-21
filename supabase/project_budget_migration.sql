-- Project budget as a ledger: the starting contract plus every later
-- addition (a new stage sold, an approved client estimate). The sum is kept
-- in projects.contract_amount, which the rest of the app already reads.
create table if not exists project_budget_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null default 'addition' check (kind in ('base', 'addition', 'estimate')),
  title text not null,
  amount numeric not null default 0,
  task_id uuid references pm_tasks(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists project_budget_items_project_idx on project_budget_items (project_id, created_at);
-- One budget line per approved task estimate
create unique index if not exists project_budget_items_task_idx on project_budget_items (task_id) where task_id is not null;
-- Admin-only data: no policies, so only the server (service role) reads and writes it
alter table project_budget_items enable row level security;
