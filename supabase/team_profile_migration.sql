-- Team member profiles: photo, nickname, custom status (emoji + text)
alter table team_members add column if not exists avatar_url text;
alter table team_members add column if not exists nickname text;
alter table team_members add column if not exists status_emoji text;
alter table team_members add column if not exists status_text text;
