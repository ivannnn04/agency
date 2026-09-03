-- Direct messages between internal users (admin + team members).
-- Reuses project_messages: dm_key = sorted pair of participant keys,
-- e.g. 'admin|team-<uuid>'. Clients never see these rows (portal queries
-- filter by project + client channel only).
alter table project_messages add column if not exists dm_key text;
create index if not exists project_messages_dm_idx on project_messages(dm_key);
