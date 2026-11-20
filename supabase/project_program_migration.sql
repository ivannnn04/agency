-- Project programme: overall dates, roadmap phases, Fellow calls on projects
-- and the AI project review.

alter table projects add column if not exists start_date date;
alter table projects add column if not exists deadline date;

-- Roadmap phases shown on the Gantt above the tasks. Same open policy as
-- pm_tasks: it is board data the team works with.
create table if not exists project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  start_date date,
  end_date date,
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz default now()
);
create index if not exists project_milestones_project_idx on project_milestones (project_id, position);
alter table project_milestones enable row level security;
drop policy if exists "project_milestones_all" on project_milestones;
create policy "project_milestones_all" on project_milestones for all using (true) with check (true);

-- A synced call can belong to a project (as well as, or instead of, a lead)
alter table lead_meetings add column if not exists project_id uuid references projects(id) on delete set null;
create index if not exists lead_meetings_project_idx on lead_meetings (project_id, started_at);

-- AI review of how the project is going. Built from call transcripts and
-- client chat, so closed to the anon key like the other AI tables.
create table if not exists project_ai_reviews (
  project_id uuid primary key references projects(id) on delete cascade,
  data jsonb not null,
  generated_at timestamptz not null default now()
);
alter table project_ai_reviews enable row level security;
