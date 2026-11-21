-- Client task → estimate → client approval → To-Do.
-- A task a client adds waits outside the board columns (column_id is null)
-- until the client approves the team's estimate.
--   estimate_status: needed  — the team has to estimate it
--                    sent    — the estimate is with the client
--                    changes — the client commented, the team revises
--                    approved — accepted, the task is in To-Do
alter table pm_tasks add column if not exists estimate_status text;
alter table pm_tasks add column if not exists estimate_cost numeric;
alter table pm_tasks add column if not exists estimate_note text;
alter table pm_tasks add column if not exists estimate_sent_at timestamptz;
alter table pm_tasks add column if not exists estimate_client_comment text;
alter table pm_tasks add column if not exists estimate_decided_at timestamptz;
alter table pm_tasks add column if not exists requested_by_client_id uuid references clients(id) on delete set null;

create index if not exists pm_tasks_estimate_pending_idx
  on pm_tasks (finance_project_id)
  where estimate_status in ('needed', 'sent', 'changes');
