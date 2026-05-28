'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function BalancePage() {
  const [cash, setCash] = useState(0)
  const [receivables, setReceivables] = useState(0)
  const [payables, setPayables] = useState(0)
  const [profit, setProfit] = useState(0)

  useEffect(() => {
    async function fetchData() {
      const { data: accounts } = await supabase.from('accounts').select('balance, currency')
      const { data: txs } = await supabase.from('transactions').select('type, amount, counterparty_id').eq('is_planned', false)

      if (accounts) {
        const totalCash = accounts.reduce((s, a) => s + a.balance, 0)
        setCash(totalCash)
      }

      if (txs) {
        const incomeWithCP = txs.filter(t => t.type === 'income' && t.counterparty_id)
        const expenseWithCP = txs.filter(t => t.type === 'expense' && t.counterparty_id)

        const rec = incomeWithCP.reduce((s, t) => s + t.amount, 0)
        const pay = expenseWithCP.reduce((s, t) => s + t.amount, 0)
        const totalIncome = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
        const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

        setReceivables(rec)
        setPayables(pay)
        setProfit(totalIncome - totalExpense)
      }
    }
    fetchData()
  }, [])

  const workingCapital = receivables + cash
  const totalAssets = workingCapital
  const totalLiabilities = profit + payables

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Баланс</h1>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Assets */}
        <div>
          <h2 className="text-lg font-bold text-center text-gray-800 mb-4">
            Активи ₴ {totalAssets.toLocaleString('uk-UA')}
          </h2>
          <div className="space-y-3">
            <BalanceRow label="I. Необоротні активи" value={0} bold />
            <BalanceRow label="Основні засоби" value={0} indent />
            <BalanceRow label="Нематеріальні активи" value={0} indent />
            <BalanceRow label="Інвестиції" value={0} indent />
            <div className="border-t border-gray-100 pt-3">
              <BalanceRow label="II. Оборотні активи" value={workingCapital} bold />
              <BalanceRow label="Запаси" value={0} indent />
              <BalanceRow label="Дебіторська заборгованість" value={receivables} indent />
              <BalanceRow label="III. Гроші" value={cash} indent />
            </div>
          </div>
        </div>

        {/* Liabilities */}
        <div>
          <h2 className="text-lg font-bold text-center text-gray-800 mb-4">
            Пасиви ₴ {totalLiabilities.toLocaleString('uk-UA')}
          </h2>
          <div className="space-y-3">
            <BalanceRow label="I. Капітал власника" value={profit} bold />
            <BalanceRow label="Статутний капітал" value={0} indent />
            <BalanceRow label="Додатковий капітал" value={0} indent />
            <BalanceRow label="Нерозподілений прибуток" value={profit} indent />
            <div className="border-t border-gray-100 pt-3">
              <BalanceRow label="II. Позиковий капітал" value={payables} bold />
              <BalanceRow label="Кредиторська заборгованість" value={payables} indent />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BalanceRow({ label, value, bold, indent }: { label: string; value: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 ${indent ? 'pl-4' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
        ₴ {value.toLocaleString('uk-UA')}
      </span>
    </div>
  )
}
