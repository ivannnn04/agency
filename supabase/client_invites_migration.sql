-- Email invitations for portal clients (same token flow as team invites)
alter table clients add column if not exists invited_at timestamptz;
alter table clients add column if not exists invite_token text;
alter table clients add column if not exists invite_expires_at timestamptz;
create index if not exists clients_invite_token_idx on clients(invite_token);
