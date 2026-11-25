-- What the client sees of the money behind the hours: the hourly rate the
-- project is billed at, and whether amounts (per task, tracked total, pending
-- payment) are shown in the client's workspace next to the hours.
alter table projects add column if not exists client_hourly_rate numeric;
alter table projects add column if not exists show_tracked_amounts boolean not null default false;
