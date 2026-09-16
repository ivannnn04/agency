-- Per-account notification sound preferences (which sound + volume 0-100).
alter table team_members add column if not exists notif_sound text default 'ping';
alter table team_members add column if not exists notif_volume int default 70;
alter table admin_profile add column if not exists notif_sound text default 'ping';
alter table admin_profile add column if not exists notif_volume int default 70;
