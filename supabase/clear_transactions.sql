-- Wipes the entire payment history (all income/expense/transfer records).
-- Account balances are NOT touched — they are stored as running totals on
-- accounts.balance and can be corrected manually from the sidebar.
-- invoices.transaction_id references are set to null automatically.

delete from transactions;
