-- Selected team members may create projects themselves (admin grants per member)
alter table team_members add column if not exists can_create_projects boolean not null default false;
