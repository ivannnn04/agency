-- ПОВЕРНЕННЯ (лише якщо треба скасувати КРОК 2):
-- прибирає записані 26.11.2026 плани й повертає ті, що були до того.
begin;
delete from transactions where is_planned and type = 'income' and comment like 'План: % · оновлено 26.11.2026';
insert into transactions select b.* from planned_income_backup_20261126 b
  where not exists (select 1 from transactions t where t.id = b.id);
commit;
