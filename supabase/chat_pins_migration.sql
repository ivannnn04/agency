-- Pinned chat messages (project chats + general chats share project_messages)
alter table project_messages add column if not exists pinned boolean not null default false;
