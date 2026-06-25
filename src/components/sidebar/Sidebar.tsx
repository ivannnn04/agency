'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { Account } from '@/types'
import {
  Plus, Trash2, RefreshCw, TrendingUp, FolderKanban,
  ArrowLeftRight, BarChart2, FileText, Users, CheckSquare, DollarSign,
} from 'lucide-react'
import AddAccountModal from '@/components/modals/AddAccountModal'

function currencySymbol(currency: string) {
  if (currency === 'USD') return '$'
  if (currency === 'EUR') return '€'
  return '₴'
}

const financeNav = [
  { label: 'Платежі',   href: '/',            icon: ArrowLeftRight },
  { label: 'Аналітика', href: '/analytics',   icon: BarChart2 },
  { label: 'Дебіторка', href: '/receivables', icon: FileText },
  { label: 'Зарплата',  href: '/payroll',     icon: DollarSign },
]

const projectsNav = [
  { label: 'Проекти', href: '/projects', icon: FolderKanban },
  { label: 'Ліди',    href: '/leads',    icon: Users },
  { label: 'To-Do',   href: '/todo',     icon: CheckSquare },
]

function isProjectsPath(p: string) {
  return p.startsWith('/projects') || p.startsWith('/leads') || p.startsWith('/todo')
}

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  const [section, setSection] = useState<'finance' | 'projects'>(
    isProjectsPath(pathname) ? 'projects' : 'finance'
  )
  const [accounts, setAccounts] = useState<Account[]>([])
  const [plannedIncome, setPlannedIncome]   = useState(0)
  const [plannedExpense, setPlannedExpense] = useState(0)
  const [addAccountOpen, setAddAccountOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const { rates, loading: ratesLoading, toUSD, fmtUSD } = useRates()

  const totalUSD = accounts.reduce((s, a) => s + toUSD(a.balance, a.currency), 0)

  useEffect(() => {
    setSection(isProjectsPath(pathname) ? 'projects' : 'finance')
  }, [pathname])

  useEffect(() => {
    fetchAccounts()
    fetchPlanned()
  }, [])

  async function fetchAccounts() {
    const { data } = await supabase.from('accounts').select('*').order('created_at')
    if (data) setAccounts(data)
  }

  async function deleteAccount(id: string) {
    await supabase.from('accounts').delete().eq('id', id)
    fetchAccounts()
  }

  function startEdit(account: Account) {
    setEditingId(account.id)
    setEditValue(String(account.balance))
  }

  async function saveEdit(account: Account) {
    const newBalance = parseFloat(editValue)
    setEditingId(null)
    if (isNaN(newBalance) || newBalance === account.balance) return
    await supabase.from('accounts').update({ balance: newBalance }).eq('id', account.id)
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
      const income  = data.filter(t => t.type === 'income').reduce((s, t)  => s + toUSD(t.amount, t.currency), 0)
      const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + toUSD(t.amount, t.currency), 0)
      setPlannedIncome(income)
      setPlannedExpense(expense)
    }
  }

  useEffect(() => {
    if (!ratesLoading) fetchPlanned()
  }, [ratesLoading])

  const navItems = section === 'finance' ? financeNav : projectsNav

  return (
    <>
      <aside className="w-[240px] min-w-[240px] bg-[#0f1117] text-white flex flex-col overflow-hidden border-r border-white/5">

        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Agency</p>
              <p className="text-gray-500 text-xs">управління бізнесом</p>
            </div>
          </div>
        </div>

        {/* Section tabs */}
        <div className="px-3 py-3 border-b border-white/5 flex-shrink-0">
          <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => { setSection('finance'); router.push('/') }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                section === 'finance' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <TrendingUp size={12} />
              Фінанси
            </button>
            <button
              onClick={() => { setSection('projects'); router.push('/projects') }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                section === 'projects' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <FolderKanban size={12} />
              Проєкти
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 py-2 border-b border-white/5 flex-shrink-0">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 text-left ${
                  isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={15} />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Financial data — only in finance section */}
        {section === 'finance' && (
          <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
            <div>
              <p className="text-xs text-gray-400 mb-1">Всього на рахунках</p>
              <p className="text-2xl font-bold">{fmtUSD(totalUSD)}</p>
            </div>

            {/* NBU rates */}
            <div className="bg-white/5 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Курс НБУ</p>
                <RefreshCw size={11} className={`text-gray-600 ${ratesLoading ? 'animate-spin' : ''}`} />
              </div>
              {ratesLoading ? (
                <p className="text-xs text-gray-500">Завантаження...</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">$ 1 USD</span>
                    <span className="text-gray-200">₴ {rates.USD.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">€ 1 EUR</span>
                    <span className="text-gray-200">₴ {rates.EUR.toFixed(2)}</span>
                  </div>
                  {rates.date && <p className="text-[10px] text-gray-600 mt-0.5">{rates.date}</p>}
                </div>
              )}
            </div>

            {/* Accounts */}
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
                {accounts.map(account => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-white/5 group cursor-default"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: account.color }} />
                      <span className="text-sm text-gray-200 truncate">{account.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="text-right" onClick={() => startEdit(account)} title="Клікніть щоб змінити баланс">
                        {editingId === account.id ? (
                          <input
                            type="number"
                            step="0.01"
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => saveEdit(account)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit(account)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="w-24 text-xs text-right bg-white/10 text-white border border-white/30 rounded px-1.5 py-0.5 focus:outline-none focus:border-teal-400"
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <div className="text-xs text-gray-400 cursor-pointer hover:text-white transition-colors">
                            {currencySymbol(account.currency)}{account.balance.toLocaleString('en-US')}
                          </div>
                        )}
                        {editingId !== account.id && account.currency !== 'USD' && rates.USD > 0 && (
                          <div className="text-[10px] text-gray-600">
                            ≈ {fmtUSD(toUSD(account.balance, account.currency))}
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

            {/* Planned */}
            <div className="border-t border-white/10 pt-3 mt-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Планові платежі</p>
                <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">30 днів</span>
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Доходи</span>
                  <span className="text-teal-400">{fmtUSD(plannedIncome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Витрати</span>
                  <span className="text-red-400">{fmtUSD(plannedExpense)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        onSuccess={() => { setAddAccountOpen(false); fetchAccounts() }}
      />
    </>
  )
}
