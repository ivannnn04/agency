'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function BalancePage() {
  const [cash, setCash] = useState(0)
  const [receivables, setReceivables] = useState(0)
  const [payables, setPayables] = useState(0)
  const [profit, setProfit] = useState(0)
  const { toUAH, loading: ratesLoading } = useRates()

  useEffect(() => { if (!ratesLoading) fetchData() }, [ratesLoading])

  async function fetchData() {
    const { data: accounts } = await supabase.from('accounts').select('balance, currency')
    const { data: txs } = await supabase.from('transactions').select('type, amount, currency, counterparty_id').eq('is_planned', false)

    if (accounts) {
      const totalCash = accounts.reduce((s, a) => s + toUAH(a.balance, a.currency), 0)
      setCash(totalCash)
    }

    if (txs) {
      const rec = txs.filter(t => t.type === 'income'  && t.counterparty_id).reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      const pay = txs.filter(t => t.type === 'expense' && t.counterparty_id).reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      const totalIncome  = txs.filter(t => t.type === 'income').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency), 0)
      setReceivables(rec)
      setPayables(pay)
      setProfit(totalIncome - totalExpense)
    }
  }

  const workingCapital   = receivables + cash
  const totalAssets      = workingCapital
  const totalLiabilities = profit + payables

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Баланс</h1>
        <p className="text-sm text-gray-400 ml-1">· всі суми в ₴ UAH</p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <h2 className="text-lg font-bold text-center text-gray-800 mb-4">
            Активи ₴ {Math.round(totalAssets).toLocaleString('uk-UA')}
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

        <div>
          <h2 className="text-lg font-bold text-center text-gray-800 mb-4">
            Пасиви ₴ {Math.round(totalLiabilities).toLocaleString('uk-UA')}
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
        ₴ {Math.round(value).toLocaleString('uk-UA')}
      </span>
    </div>
  )
}
