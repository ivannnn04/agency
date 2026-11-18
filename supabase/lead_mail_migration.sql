-- Mailbox sync for leads: remember each letter's Message-ID so the same
-- letter is never stored twice.
alter table lead_emails add column if not exists message_id text;
create unique index if not exists lead_emails_message_id_key on lead_emails (message_id) where message_id is not null;
create index if not exists lead_emails_lead_idx on lead_emails (lead_id, sent_at);
