-- Add email to profiles for team member management
alter table profiles add column if not exists email text;

-- Index for email lookup
create index if not exists profiles_email_idx on profiles(email);

-- Allow members to view all profiles in their projects
-- (needed for assignee picker, member lists)
drop policy if exists "Users can view profiles" on profiles;
create policy "Users can view profiles" on profiles
  for select using (auth.uid() is not null);

-- Allow admin to update any profile (for hourly rate, etc.)
drop policy if exists "Admin can update profiles" on profiles;
create policy "Admin can update profiles" on profiles
  for update using (
    auth.uid() = id
    or exists(select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- pm_project_members policies (clean up and fix)
drop policy if exists "Project owners can manage members" on pm_project_members;
drop policy if exists "Members can view project members" on pm_project_members;
drop policy if exists "Users can view members of their projects" on pm_project_members;
drop policy if exists "Owners can add members" on pm_project_members;
drop policy if exists "Owners can remove members" on pm_project_members;

create policy "View project members" on pm_project_members
  for select using (auth.uid() is not null);

create policy "Manage project members" on pm_project_members
  for all using (
    exists(select 1 from profiles where id = auth.uid() and role = 'admin')
    or user_id = auth.uid()
  );
