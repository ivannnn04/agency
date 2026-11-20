-- Language of the client's workspace, set by the admin per client
alter table clients add column if not exists lang text not null default 'en';
