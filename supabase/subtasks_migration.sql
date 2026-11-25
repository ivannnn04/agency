-- Subtasks, time on subtasks, and a formatted task description.
--
-- Time on a subtask is stored on its parent task (task_id) and marked with
-- subtask_id, so every existing total — payroll, invoicing, the client's
-- hours — keeps counting it with the task. Deleting a subtask keeps its time
-- on the task.

create table if not exists pm_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pm_tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz default now()
);
create index if not exists pm_subtasks_task_idx on pm_subtasks (task_id, position);
alter table pm_subtasks enable row level security;
-- Same access as the tasks themselves (both boards read and write them directly)
drop policy if exists "pm_subtasks_all" on pm_subtasks;
create policy "pm_subtasks_all" on pm_subtasks for all using (true) with check (true);

alter table time_entries add column if not exists subtask_id uuid references pm_subtasks(id) on delete set null;
create index if not exists time_entries_subtask_idx on time_entries (subtask_id) where subtask_id is not null;
alter table admin_time_entries add column if not exists subtask_id uuid references pm_subtasks(id) on delete set null;

-- The description with its formatting (bold, highlight, lists, checklists).
-- The plain "description" stays alongside it for emails, AI and previews.
alter table pm_tasks add column if not exists description_html text;
