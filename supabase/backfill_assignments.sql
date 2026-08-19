-- One-off repair: sync existing assignments into the join table and
-- project membership, so already-assigned tasks show up for the team.
-- Safe to run any number of times.

-- Tasks assigned via the detail panel only touched pm_tasks.team_member_id
insert into task_assignees (task_id, team_member_id)
select id, team_member_id from pm_tasks
where team_member_id is not null
on conflict do nothing;

-- Anyone assigned to a task becomes a member of that task's project
insert into project_members (project_id, team_member_id)
select distinct t.finance_project_id, ta.team_member_id
from task_assignees ta
join pm_tasks t on t.id = ta.task_id
where t.finance_project_id is not null
on conflict do nothing;
