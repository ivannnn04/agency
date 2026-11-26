-- ═══════════════════════════════════════════════════════════════════════
-- КРОК 2 з 2 · ЗАСТОСУВАТИ (запускай після перевірки КРОКУ 1)
-- 1) Копіює всі теперішні заплановані доходи в резервну таблицю
--    planned_income_backup_20261126 (їх можна повернути).
-- 2) Прибирає їх із майбутніх платежів.
-- 3) Записує 14 нових запланованих доходів на 10.12.2026.
-- Фактичні платежі, витрати й баланси рахунків НЕ змінюються.
-- Скрипт можна запустити повторно — результат буде той самий.
-- ═══════════════════════════════════════════════════════════════════════
begin;

create table if not exists planned_income_backup_20261126 as
  select * from transactions with no data;
alter table planned_income_backup_20261126 enable row level security;

insert into planned_income_backup_20261126
  select t.* from transactions t
  where t.is_planned and t.type = 'income'
    -- a repeated run must not back up the plans this script wrote itself
    and coalesce(t.comment, '') not like 'План: % · оновлено 26.11.2026'
    and not exists (select 1 from planned_income_backup_20261126 b where b.id = t.id);

delete from transactions where is_planned and type = 'income';

with plan(n, client, pattern, fallback, amount, currency) as (values
    (1, 'Simetria LT', '\msimetria\M.*\mlt\M', null, 9000::numeric, 'EUR'),
    (2, 'Common Group', '\m(common|commond|command|comand|kommon)\M.*group', '\mgroup\M', 4500::numeric, 'EUR'),
    (3, 'Fahat Tripin', '\m(fah?at|fahad|fahd)\M|\mtripp?in', null, 1825::numeric, 'EUR'),
    (4, 'Fadel Fawah — платіж 1', 'fadh?el|fawa', null, 1000::numeric, 'USD'),
    (5, 'Fadel Fawah — платіж 2', 'fadh?el|fawa', null, 1500::numeric, 'USD'),
    (6, 'Cheesy Smiles (EasySmiles)', '(ea|chee)s?y\s*smiles', null, 700::numeric, 'USD'),
    (7, 'Osi Jared', '\mjare?d\M|\moss?i\M', null, 125::numeric, 'USD'),
    (8, 'Ametria', '\mametria', null, 4260::numeric, 'USD'),
    (9, 'Andy Lenard', '\ml[ei]o?nn?ard\M|\mandy\M', null, 750::numeric, 'USD'),
    (10, 'Simetria App (Site compliance app)', 'simetria.*site\s*compliance', '\msimetria\M.*\mapp\M', 1350::numeric, 'EUR'),
    (11, 'Haven Collective (Sofia Kerr)', '\mhaven\M|so(ph|f)ia\s*ker', null, 2500::numeric, 'USD'),
    (12, 'Drive Mode Winter Show', 'winter\s*show', 'drive\s*mode', 6200::numeric, 'EUR'),
    (13, 'Tasha Korian', '\mtasha\M|\mk[oa]r[iy]an\M', null, 1320::numeric, 'USD'),
    (14, 'Ricochet', 'ricochet', null, 1000::numeric, 'USD')
  ),
  -- The project each payment belongs to: an active project first, then the newest
  matched as (
    select p.*,
      coalesce(
        (select pr.id from projects pr where pr.name ~* p.pattern order by (pr.status = 'active') desc, pr.created_at desc limit 1),
        (select pr.id from projects pr where p.fallback is not null and pr.name ~* p.fallback order by (pr.status = 'active') desc, pr.created_at desc limit 1)
      ) as project_id,
      (select string_agg(pr.name, ' | ' order by pr.name) from projects pr
        where pr.name ~* p.pattern or (p.fallback is not null and pr.name ~* p.fallback)) as candidates,
      exists (select 1 from projects pr where pr.name ~* p.pattern) as exact
    from plan p
  )
insert into transactions (type, amount, currency, account_id, category_id, project_id, counterparty_id, date, comment, is_planned)
select
  'income', m.amount, m.currency,
  -- the account this project's money usually comes to, in the same currency;
  -- else the first account in that currency; else the first account
  coalesce(
    (select t.account_id from transactions t join accounts a on a.id = t.account_id
      where t.project_id = m.project_id and t.type = 'income' and a.currency = m.currency
      order by t.date desc limit 1),
    (select a.id from accounts a where a.currency = m.currency order by a.created_at limit 1),
    (select a.id from accounts a order by a.created_at limit 1)
  ),
  coalesce(
    (select t.category_id from transactions t
      where t.project_id = m.project_id and t.type = 'income' and t.category_id is not null
      order by t.date desc limit 1),
    (select t.category_id from transactions t
      where t.type = 'income' and t.category_id is not null
      group by t.category_id order by count(*) desc limit 1)
  ),
  m.project_id,
  (select t.counterparty_id from transactions t
    where t.project_id = m.project_id and t.type = 'income' and t.counterparty_id is not null
    order by t.date desc limit 1),
  timestamptz '2026-12-10 12:00:00+02',
  'План: ' || m.client || ' · оновлено 26.11.2026',
  true
from matched m
order by m.n;

commit;

-- Що тепер стоїть у майбутніх платежах
select to_char(t.date, 'DD.MM.YYYY') as "дата", t.amount as "сума", t.currency as "валюта",
       coalesce(p.name, '— без проєкту —') as "проєкт", a.name as "рахунок", t.comment as "коментар"
from transactions t
left join projects p on p.id = t.project_id
left join accounts a on a.id = t.account_id
where t.is_planned and t.type = 'income'
order by t.currency, t.amount desc;
