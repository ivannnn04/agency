-- ═══════════════════════════════════════════════════════════════════════
-- КРОК 1 з 2 · ПЕРЕВІРКА (нічого не змінює)
-- Майбутні платежі (заплановані доходи) станом на 26.11.2026.
--
-- Показує одну таблицю з трьома частинами:
--   1 НОВИЙ   — 14 платежів, які буде записано, і проєкт, з яким кожен
--               зіставився («проєкт»). «усі збіги» — якщо збігів кілька
--               або жодного, перевір назву.
--   2 ЗАРАЗ   — заплановані доходи, які зараз є в базі й буде замінено.
--   3 РАХУНОК — сума теперішніх запланованих доходів по кожному рахунку
--               (ці суми могли потрапити в баланс рахунку, див. звірку).
-- Якщо в «НОВИЙ» щось зіставилось не з тим проєктом — напиши мені, я
-- поправлю шаблон, і лише тоді запускай КРОК 2.
-- ═══════════════════════════════════════════════════════════════════════
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
select * from (
  select 1 as part, '1 НОВИЙ' as section, m.n, m.client as "платіж / коментар",
         m.amount as "сума", m.currency as "валюта",
         case when pr.name is null then '⚠ проєкт не знайдено — буде без проєкту'
              when not m.exact then pr.name || '  ⚠ схожа назва — перевір'
              else pr.name end as "проєкт",
         coalesce(m.candidates, '') as "усі збіги", '10.12.2026' as "дата"
  from matched m left join projects pr on pr.id = m.project_id
  union all
  select 2, '2 ЗАРАЗ', null, coalesce(t.comment, ''), t.amount, t.currency,
         coalesce(pr.name, '— без проєкту —'), coalesce(a.name, ''), to_char(t.date, 'DD.MM.YYYY')
  from transactions t
  left join projects pr on pr.id = t.project_id
  left join accounts a on a.id = t.account_id
  where t.is_planned and t.type = 'income'
  union all
  select 3, '3 РАХУНОК', null, a.name, sum(t.amount), t.currency, '', 'сума теперішніх запланованих доходів', ''
  from transactions t join accounts a on a.id = t.account_id
  where t.is_planned and t.type = 'income'
  group by a.name, t.currency
) x
order by part, n nulls last, "валюта", "сума" desc;
