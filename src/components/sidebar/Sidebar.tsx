'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Account } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Plus, Trash2 } from 'lucide-react'
import AddAccountModal from '@/components/modals/AddAccountModal'

export default function Sidebar() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [totalBalance, setTotalBalance] = useState(0)
  const [plannedIncome, setPlannedIncome] = useState(0)
  const [plannedExpense, setPlannedExpense] = useState(0)
  const [addAccountOpen, setAddAccountOpen] = useState(false)

  useEffect(() => {
    fetchAccounts()
    fetchPlanned()
  }, [])

  async function fetchAccounts() {
    const { data } = await supabase.from('accounts').select('*').order('created_at')
    if (data) {
      setAccounts(data)
      const total = data.reduce((sum, a) => sum + a.balance, 0)
      setTotalBalance(total)
    }
  }

  async function deleteAccount(id: string) {
    await supabase.from('accounts').delete().eq('id', id)
    fetchAccounts()
  }

  async function fetchPlanned() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

    const { data } = await supabase
      .from('transactions')
      .select('type, amount')
      .eq('is_planned', true)
      .gte('date', startOfMonth)
      .lte('date', endOfMonth)

    if (data) {
      const income = data.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      setPlannedIncome(income)
      setPlannedExpense(expense)
    }
  }

  return (
    <>
      <aside className="w-[220px] min-w-[220px] bg-[#0f1117] text-white flex flex-col p-4 gap-4 overflow-y-auto border-r border-white/5">
        <div>
          <p className="text-xs text-gray-400 mb-1">Всього на рахунках</p>
          <p className="text-2xl font-bold">₴ {totalBalance.toLocaleString('uk-UA')}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Мої рахунки</p>
            <button
              onClick={() => setAddAccountOpen(true)}
              className="text-gray-500 hover:text-white transition-colors p-0.5 rounded"
              title="Додати рахунок"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {accounts.length === 0 && (
              <button
                onClick={() => setAddAccountOpen(true)}
                className="text-xs text-gray-500 hover:text-gray-300 py-1 text-left transition-colors"
              >
                + Додати перший рахунок
              </button>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-white/5 group cursor-default"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-1 h-5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: account.color }}
                  />
                  <span className="text-sm text-gray-200 truncate">{account.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">
                    {account.currency === 'UAH' ? '₴' : account.currency === 'USD' ? '$' : '€'}{' '}
                    {account.balance.toLocaleString('uk-UA')}
                  </span>
                  <button
                    onClick={() => deleteAccount(account.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all ml-1"
                    title="Видалити рахунок"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Планові платежі</p>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">1 міс</span>
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Планові доходи</span>
              <span className="text-teal-400">₴ {plannedIncome.toLocaleString('uk-UA')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Планові витрати</span>
              <span className="text-red-400">₴ {plannedExpense.toLocaleString('uk-UA')}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-3 mt-auto">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300 font-medium">Всього на рахунках</span>
            <span className="text-white font-semibold">₴ {totalBalance.toLocaleString('uk-UA')}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">(з урах. майбутніх платежів)</p>
        </div>
      </aside>

      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        onSuccess={() => {
          setAddAccountOpen(false)
          fetchAccounts()
        }}
      />
    </>
  )
}
