-- Reply-to-message in chats (project + general share project_messages)
alter table project_messages add column if not exists reply_to_message_id uuid references project_messages(id) on delete set null;
