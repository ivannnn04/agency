-- Hour estimate for tasks
alter table pm_tasks add column if not exists estimate_hours numeric;

-- Hard estimate system: who set each estimate (for accuracy reports)
alter table pm_tasks add column if not exists estimate_by text;
