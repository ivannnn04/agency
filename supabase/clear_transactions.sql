-- Wipe the entire payment history (Платежі page), including planned payments.
-- Account balances are NOT touched: balances live on the accounts table as a
-- running total, so current balances stay exactly as they are now.
-- invoices.transaction_id references transactions with ON DELETE SET NULL,
-- so receivables records survive (their link to a transaction is just cleared).

delete from transactions;

-- Optional (uncomment if you also want a clean receivables slate):
-- delete from invoices;
