-- Link PM projects to financial projects
alter table pm_projects add column if not exists finance_project_id uuid references projects(id) on delete set null;

-- Hourly rate per team member (for cost calculation)
alter table profiles add column if not exists hourly_rate_usd numeric(8,2) default 0;

-- Status sync: PM status → Finance status
create or replace function sync_pm_project_to_finance()
returns trigger as $$
declare
  fin_status text;
begin
  if new.finance_project_id is null then return new; end if;
  if new.status = old.status then return new; end if;

  fin_status := case new.status
    when 'done'   then 'archived'
    when 'paused' then 'inactive'
    else 'active'
  end;

  update projects
  set
    status      = fin_status,
    archived_at = case when fin_status = 'archived' then now() else null end
  where id = new.finance_project_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists pm_project_sync on pm_projects;
create trigger pm_project_sync
  after update on pm_projects
  for each row execute procedure sync_pm_project_to_finance();

-- RPC: summary of PM data per financial project (bypasses RLS so anon key can call it)
create or replace function get_pm_project_summary(p_finance_project_ids uuid[])
returns table (
  finance_project_id uuid,
  pm_project_id      uuid,
  pm_project_name    text,
  pm_status          text,
  total_hours        numeric
)
language sql
security definer
stable
as $$
  select
    p.finance_project_id,
    p.id,
    p.name,
    p.status,
    coalesce(sum(tl.duration_s) filter (where tl.ended_at is not null), 0) / 3600.0
  from pm_projects p
  left join pm_tasks   t  on t.project_id = p.id
  left join pm_time_logs tl on tl.task_id  = t.id
  where p.finance_project_id = any(p_finance_project_ids)
  group by p.id;
$$;

grant execute on function get_pm_project_summary(uuid[]) to anon, authenticated;
