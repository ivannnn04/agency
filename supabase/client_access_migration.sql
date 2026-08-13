-- Client-facing read-only status link per project (no login required)
alter table projects add column if not exists client_access_token text unique default gen_random_uuid()::text;
