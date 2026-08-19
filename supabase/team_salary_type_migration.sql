-- Team members can be paid hourly (from tracked time) or a fixed monthly salary
alter table team_members add column if not exists salary_type text not null default 'hourly'
  check (salary_type in ('hourly', 'monthly'));
alter table team_members add column if not exists monthly_salary_usd numeric;
