'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Account } from '@/types'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import AddAccountModal from '@/components/modals/AddAccountModal'

interface Rates {
  USD: number
  EUR: number
  date: string
}

function toUAH(amount: number, currency: string, rates: Rates): number {
  if (currency === 'UAH') return amount
  return amount * (rates[currency as 'USD' | 'EUR'] ?? 1)
}

function currencySymbol(currency: string) {
  if (currency === 'USD') return '$'
  if (currency === 'EUR') return '€'
  return '₴'
}

export default function Sidebar() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rates, setRates] = useState<Rates>({ USD: 0, EUR: 0, date: '' })
  const [ratesLoading, setRatesLoading] = useState(true)
  const [plannedIncome, setPlannedIncome] = useState(0)
  const [plannedExpense, setPlannedExpense] = useState(0)
  const [addAccountOpen, setAddAccountOpen] = useState(false)

  const totalBalance = accounts.reduce((sum, a) => sum + toUAH(a.balance, a.currency, rates), 0)

  useEffect(() => {
    fetchAccounts()
    fetchPlanned()
    fetchRates()
  }, [])

  async function fetchRates() {
    setRatesLoading(true)
    try {
      const res = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')
      const data: { cc: string; rate: number; exchangedate: string }[] = await res.json()
      const usd = data.find(r => r.cc === 'USD')
      const eur = data.find(r => r.cc === 'EUR')
      if (usd && eur) {
        setRates({ USD: usd.rate, EUR: eur.rate, date: usd.exchangedate })
      }
    } catch {
      // keep zeros — will show N/A
    }
    setRatesLoading(false)
  }

  async function fetchAccounts() {
    const { data } = await supabase.from('accounts').select('*').order('created_at')
    if (data) setAccounts(data)
  }

  async function deleteAccount(id: string) {
    await supabase.from('accounts').delete().eq('id', id)
    fetchAccounts()
  }

  async function fetchPlanned() {
    const now = new Date()
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const { data } = await supabase
      .from('transactions')
      .select('type, amount, currency')
      .eq('is_planned', true)
      .gte('date', now.toISOString())
      .lte('date', in30Days.toISOString())

    if (data) {
      const income = data.filter(t => t.type === 'income').reduce((s, t) => s + toUAH(t.amount, t.currency, rates), 0)
      const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + toUAH(t.amount, t.currency, rates), 0)
      setPlannedIncome(income)
      setPlannedExpense(expense)
    }
  }

  return (
    <>
      <aside className="w-[220px] min-w-[220px] bg-[#0f1117] text-white flex flex-col p-4 gap-4 overflow-y-auto border-r border-white/5">
        <div>
          <p className="text-xs text-gray-400 mb-1">Всього на рахунках</p>
          <p className="text-2xl font-bold">₴ {totalBalance.toLocaleString('uk-UA', { maximumFractionDigits: 0 })}</p>
        </div>

        {/* NBU rates */}
        <div className="bg-white/5 rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Курс НБУ</p>
            <button onClick={fetchRates} className="text-gray-600 hover:text-gray-300 transition-colors" title="Оновити курс">
              <RefreshCw size={11} className={ratesLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {ratesLoading ? (
            <p className="text-xs text-gray-500">Завантаження...</p>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">$ USD</span>
                <span className="text-gray-200">₴ {rates.USD.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">€ EUR</span>
                <span className="text-gray-200">₴ {rates.EUR.toFixed(2)}</span>
              </div>
              {rates.date && (
                <p className="text-[10px] text-gray-600 mt-0.5">{rates.date}</p>
              )}
            </div>
          )}
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
                  <div className="text-right">
                    <div className="text-xs text-gray-400">
                      {currencySymbol(account.currency)} {account.balance.toLocaleString('uk-UA')}
                    </div>
                    {account.currency !== 'UAH' && rates.USD > 0 && (
                      <div className="text-[10px] text-gray-600">
                        ≈ ₴ {toUAH(account.balance, account.currency, rates).toLocaleString('uk-UA', { maximumFractionDigits: 0 })}
                      </div>
                    )}
                  </div>
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
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">30 днів</span>
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Планові доходи</span>
              <span className="text-teal-400">₴ {plannedIncome.toLocaleString('uk-UA', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Планові витрати</span>
              <span className="text-red-400">₴ {plannedExpense.toLocaleString('uk-UA', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-3 mt-auto">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300 font-medium">Всього на рахунках</span>
            <span className="text-white font-semibold">₴ {totalBalance.toLocaleString('uk-UA', { maximumFractionDigits: 0 })}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">за курсом НБУ</p>
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
