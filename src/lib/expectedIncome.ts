'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { adjustBalancesForTransaction } from '@/lib/transactionBalances'

// Expected income: planned income operations (is_planned) — money that should
// come in once projects are closed. The date is an estimate, not a deadline.

export interface ExpectedRow {
  id: string
  type: 'income'
  amount: number
  currency: 'USD' | 'EUR' | 'UAH'
  account_id: string
  project_id: string | null
  date: string
  comment: string | null
  is_planned: boolean
  created_at: string
  account?: { id: string; name: string; currency: string } | null
  project?: { id: string; name: string; color: string | null } | null
  counterparty?: { id: string; name: string } | null
}

export const EXPECTED_CHANGED = 'gudrix:expected-changed'

// "План: Ricochet · оновлено 26.11.2026" → "Ricochet"
export const cleanComment = (c: string | null | undefined) =>
  (c ?? '').replace(/^План:\s*/, '').replace(/\s*·\s*оновлено\s+\d{2}\.\d{2}\.\d{4}\s*$/, '').trim()

// 1 платіж · 2 платежі · 5 платежів
export const payments = (n: number) => {
  const d = n % 10, h = n % 100
  return `${n} ${d === 1 && h !== 11 ? 'платіж' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'платежі' : 'платежів'}`
}

export const daysUntil = (iso: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(iso); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

export function useExpectedIncome() {
  const [rows, setRows] = useState<ExpectedRow[] | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    let alive = true
    supabase
      .from('transactions')
      .select(`*, account:accounts!account_id(id, name, currency), project:projects(id, name, color), counterparty:counterparties(id, name)`)
      .eq('is_planned', true)
      .eq('type', 'income')
      .order('date', { ascending: true })
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) { setError(err.message); setRows([]); return }
        setRows(((data ?? []) as ExpectedRow[]).sort((x, y) => x.date.localeCompare(y.date)))
      })
    return () => { alive = false }
  }, [nonce])

  useEffect(() => {
    window.addEventListener(EXPECTED_CHANGED, reload)
    return () => window.removeEventListener(EXPECTED_CHANGED, reload)
  }, [reload])

  return { rows, error, reload }
}

const announce = () => {
  window.dispatchEvent(new Event(EXPECTED_CHANGED))
  // the sidebar's planned block and account balances
  window.dispatchEvent(new Event('gudrix:projects-changed'))
}

export async function updateExpected(id: string, patch: { date?: string; amount?: number }) {
  const { error } = await supabase.from('transactions').update(patch).eq('id', id).eq('is_planned', true)
  if (error) throw new Error(error.message)
  announce()
}

// The money came in: the operation becomes actual (today, unless told
// otherwise) and only now goes onto the account's balance
export async function markReceived(row: ExpectedRow, amount = row.amount, on = new Date()) {
  const { error } = await supabase
    .from('transactions')
    .update({ is_planned: false, amount, date: on.toISOString() })
    .eq('id', row.id)
    .eq('is_planned', true)
  if (error) throw new Error(error.message)
  await adjustBalancesForTransaction({ type: 'income', amount, account_id: row.account_id, is_planned: false }, 1)
  announce()
}

// A planned operation never moved a balance, so removing it moves nothing either
export async function removeExpected(id: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', id).eq('is_planned', true)
  if (error) throw new Error(error.message)
  announce()
}
