import { supabase } from '@/lib/supabase'
import { TransactionType } from '@/types'

interface BalanceTx {
  type: TransactionType
  amount: number
  account_id: string
  to_account_id?: string | null
  to_amount?: number | null
}

// Applies (sign = 1) or reverses (sign = -1) a transaction's effect on account balances.
// Account balances are a running total (not computed from transaction history), so
// editing/deleting a transaction must explicitly undo its old effect before applying a new one.
export async function adjustBalancesForTransaction(tx: BalanceTx, sign: 1 | -1) {
  if (tx.type === 'income') {
    await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: sign * tx.amount })
  } else if (tx.type === 'expense') {
    await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: -sign * tx.amount })
  } else if (tx.type === 'transfer') {
    await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: -sign * tx.amount })
    if (tx.to_account_id) {
      const toAmt = tx.to_amount ?? tx.amount
      await supabase.rpc('update_account_balance', { p_account_id: tx.to_account_id, p_delta: sign * toAmt })
    }
  }
}
