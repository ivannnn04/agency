-- Project communication in one place: the letters exchanged with a project's
-- clients (pulled from the mailbox), and action items taken out of the
-- project's calls, waiting for the admin's approval before they become tasks.
-- Both hold private correspondence, so RLS is on with NO policies: only the
-- admin API (service role) reads and writes them.

create table if not exists project_emails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  subject text,
  body text,
  from_email text,
  to_email text,
  sent_at timestamptz not null default now(),
  message_id text not null,
  -- A letter the platform sent by itself (notification, invitation)
  automated boolean not null default false,
  created_at timestamptz default now(),
  unique (project_id, message_id)
);
create index if not exists project_emails_project_idx on project_emails (project_id, sent_at);
alter table project_emails enable row level security;

create table if not exists meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references lead_meetings(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  details text,
  owner text,
  due_date date,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed')),
  task_id uuid,
  created_at timestamptz default now(),
  decided_at timestamptz
);
create index if not exists meeting_action_items_project_idx on meeting_action_items (project_id, status);
create index if not exists meeting_action_items_meeting_idx on meeting_action_items (meeting_id);
alter table meeting_action_items enable row level security;

-- When a call's action items were last taken out (so each call is read once)
alter table lead_meetings add column if not exists actions_extracted_at timestamptz;
