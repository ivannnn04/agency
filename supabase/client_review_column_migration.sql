-- Board columns: "READY FOR REPORT" and "WAITING FOR FEEDBACK" become one
-- column, "CLIENT REVIEW". "INTERNAL REVIEW" stays as the team's own check.
-- Safe to run more than once.

-- 1. Projects that have both: tasks move to the column that stays
update pm_tasks t
set column_id = w.id
from pm_columns r
join pm_columns w on w.project_id = r.project_id
where t.column_id = r.id
  and upper(trim(r.name)) = 'READY FOR REPORT'
  and upper(trim(w.name)) = 'WAITING FOR FEEDBACK';

-- 2. The column that stays takes the earlier place on the board
update pm_columns w
set position = least(w.position, r.position)
from pm_columns r
where w.project_id = r.project_id
  and upper(trim(r.name)) = 'READY FOR REPORT'
  and upper(trim(w.name)) = 'WAITING FOR FEEDBACK';

-- 3. The emptied "READY FOR REPORT" goes away
delete from pm_columns r
using pm_columns w
where w.project_id = r.project_id
  and upper(trim(r.name)) = 'READY FOR REPORT'
  and upper(trim(w.name)) = 'WAITING FOR FEEDBACK';

-- 4. Whatever is left of the two is renamed
update pm_columns
set name = 'CLIENT REVIEW', color = '#8B5CF6'
where upper(trim(name)) in ('WAITING FOR FEEDBACK', 'READY FOR REPORT');
