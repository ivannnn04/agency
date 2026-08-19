-- Own invite tokens for team invitations (instead of Supabase one-time links,
-- which email scanners often consume before the person clicks)
alter table team_members add column if not exists invite_token text;
alter table team_members add column if not exists invite_expires_at timestamptz;
create index if not exists team_members_invite_token_idx on team_members(invite_token);
