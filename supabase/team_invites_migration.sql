-- Email invitations for team members: track when an invite was sent
alter table team_members add column if not exists invited_at timestamptz;
