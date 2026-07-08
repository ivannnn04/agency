-- Hour estimate for tasks
alter table pm_tasks add column if not exists estimate_hours numeric;
