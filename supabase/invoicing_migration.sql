-- Hourly rate on a task estimate: total = hours × rate
alter table pm_tasks add column if not exists estimate_rate numeric;

-- "To be invoiced" report: when a task became billable, what it is billed
-- for, and whether it has been put on an invoice.
alter table pm_tasks add column if not exists to_invoice_at timestamptz;
alter table pm_tasks add column if not exists invoice_amount numeric;
alter table pm_tasks add column if not exists invoiced_at timestamptz;
alter table pm_tasks add column if not exists invoice_id uuid references project_invoices(id) on delete set null;

-- Tasks already sitting in a "To be invoiced" column count for this month
update pm_tasks t
set to_invoice_at = now()
from pm_columns c
where c.id = t.column_id and c.name ~* 'invoic|інвойс' and t.to_invoice_at is null;

-- From now on the moment a task enters such a column is stamped by the
-- database itself, whichever board or tool moved it
create or replace function pm_tasks_stamp_to_invoice() returns trigger
language plpgsql as $$
begin
  if new.column_id is not null
     and (tg_op = 'INSERT' or new.column_id is distinct from old.column_id)
     and exists (select 1 from pm_columns c where c.id = new.column_id and c.name ~* 'invoic|інвойс') then
    new.to_invoice_at := now();
    new.invoiced_at := null;
    new.invoice_id := null;
  end if;
  return new;
end $$;

drop trigger if exists pm_tasks_stamp_to_invoice on pm_tasks;
create trigger pm_tasks_stamp_to_invoice
  before insert or update of column_id on pm_tasks
  for each row execute function pm_tasks_stamp_to_invoice();
