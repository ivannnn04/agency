-- Transfer fields on transactions (the add-transaction modal always sends
-- them, so without these columns EVERY insert from the modal fails)
alter table transactions add column if not exists to_account_id uuid references accounts(id);
alter table transactions add column if not exists to_amount numeric;
alter table transactions add column if not exists to_currency text;
