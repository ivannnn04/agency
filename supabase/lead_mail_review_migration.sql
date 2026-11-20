-- AI review of each letter in a lead's correspondence: how well an outgoing
-- letter moves the deal, or how best to answer an incoming one.
alter table lead_emails add column if not exists ai_review jsonb;
