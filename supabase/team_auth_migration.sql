-- Add supabase_user_id to link team members to Supabase Auth accounts
alter table team_members add column if not exists supabase_user_id uuid;
