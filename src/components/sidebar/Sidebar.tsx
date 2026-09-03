'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { useChatUnread } from '@/lib/chatUnread'
import { Account, Project } from '@/types'
import {
  Plus, Trash2, RefreshCw, TrendingUp, FolderKanban,
  ArrowLeftRight, BarChart2, FileText, Users, CheckSquare,
  DollarSign, Circle, Pencil, Hash, ChevronDown, ChevronRight, MessageSquare, Gauge, Sun,
} from 'lucide-react'
import GeneralChat, { GeneralChatInfo } from '@/components/GeneralChat'

import AddAccountModal from '@/components/modals/AddAccountModal'
import ThemeToggle from '@/components/ThemeToggle'

function currencySymbol(currency: string) {
  if (currency === 'USD') return '$'
  if (currency === 'EUR') return '€'
  return '₴'
}

const financeNav = [
  { label: 'Платежі',   href: '/',            icon: ArrowLeftRight },
  { label: 'Аналітика', href: '/analytics',   icon: BarChart2 },
  { label: 'Дебіторка', href: '/receivables', icon: FileText },
  { label: 'Ліди',      href: '/leads',       icon: Users },
  { label: 'Зарплата',  href: '/payroll',     icon: DollarSign },
  { label: 'To-Do',     href: '/todo',        icon: CheckSquare },
]

function isPMPath(p: string) {
  return p.startsWith('/board') || p.startsWith('/team-admin') || p.startsWith('/chats') || p.startsWith('/workload')
}

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 440
const SIDEBAR_DEFAULT = 240

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  const [section, setSection] = useState<'finance' | 'projects'>(
    isPMPath(pathname) ? 'projects' : 'finance'
  )
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [pmProjects, setPmProjects] = useState<Project[]>([])
  const [generalChats, setGeneralChats] = useState<GeneralChatInfo[]>([])
  const [openChat, setOpenChat] = useState<GeneralChatInfo | null>(null)
  const [newPmName, setNewPmName] = useState('')
  const [addingPm, setAddingPm]   = useState(false)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [plannedIncome, setPlannedIncome]   = useState(0)
  const [plannedExpense, setPlannedExpense] = useState(0)
  const [addAccountOpen, setAddAccountOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const { rates, loading: ratesLoading, toEUR, fmtEUR } = useRates()
  // Chat notifications for the whole admin app: sidebar dots + Slack-style ping
  const chatUnread = useChatUnread({ self: 'admin', sound: true })

  const totalUSD = accounts.reduce((s, a) => s + toEUR(a.balance, a.currency), 0)

  useEffect(() => {
    setSection(isPMPath(pathname) ? 'projects' : 'finance')
  }, [pathname])

  useEffect(() => {
    fetchAccounts()
    fetchPlanned()
    fetchPmProjects()
    const saved = Number(localStorage.getItem('sidebarWidth'))
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setSidebarWidth(saved)
    setProjectsCollapsed(localStorage.getItem('sidebarProjectsCollapsed') === '1')
  }, [])

  function toggleProjectsCollapsed() {
    setProjectsCollapsed(prev => {
      localStorage.setItem('sidebarProjectsCollapsed', prev ? '0' : '1')
      return !prev
    })
  }

  // Keep the PM project list fresh: refetch on navigation and whenever any page
  // creates/edits a project (ProjectModal and CRM won-conversion dispatch this event).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPmProjects() }, [pathname])
  useEffect(() => {
    const onChange = () => { fetchPmProjects(); fetchAccounts() }
    window.addEventListener('gudrix:projects-changed', onChange)
    return () => window.removeEventListener('gudrix:projects-changed', onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX
    const startW = sidebarWidth
    function onMove(ev: MouseEvent) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX))
      setSidebarWidth(w)
      localStorage.setItem('sidebarWidth', String(w))
    }
    function onUp() {
      setResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  async function fetchAccounts() {
    const { data } = await supabase.from('accounts').select('*').order('created_at')
    if (data) setAccounts(data)
  }

  async function fetchPmProjects() {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: true })
    if (data) setPmProjects(data)
    const { data: chats } = await supabase
      .from('general_chats')
      .select('id, name')
      .order('created_at', { ascending: true })
    if (chats) setGeneralChats(chats as GeneralChatInfo[])
  }

  async function createGeneralChat() {
    const name = window.prompt('Назва чату:')?.trim()
    if (!name) return
    const { data, error } = await supabase
      .from('general_chats')
      .insert({ name })
      .select('id, name')
      .single()
    if (error) { alert('Запусти міграцію general_chats_migration.sql'); return }
    if (data) {
      setGeneralChats(prev => [...prev, data as GeneralChatInfo])
      setOpenChat(data as GeneralChatInfo)
    }
  }

  async function createPmProject() {
    const name = newPmName.trim()
    if (!name) return
    const palette = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#10b981']
    const color = palette[pmProjects.length % palette.length]
    const { data } = await supabase
      .from('projects')
      .insert({ name, status: 'active', color })
      .select()
      .single()
    setNewPmName('')
    setAddingPm(false)
    if (data) {
      fetchPmProjects()
      router.push(`/board/${data.id}`)
    }
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
      const income  = data.filter(t => t.type === 'income').reduce((s, t)  => s + toEUR(t.amount, t.currency), 0)
      const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + toEUR(t.amount, t.currency), 0)
      setPlannedIncome(income)
      setPlannedExpense(expense)
    }
  }

  useEffect(() => {
    if (!ratesLoading) fetchPlanned()
  }, [ratesLoading])

  // Icon rail sections: Фінанси / Мій день / Проєкти
  const onDaily = pathname.startsWith('/daily')
  const railItems = [
    {
      key: 'finance', label: 'Фінанси', icon: TrendingUp,
      active: section === 'finance' && !onDaily,
      go: () => { setSection('finance'); router.push('/') },
    },
    {
      key: 'daily', label: 'Мій день', icon: Sun,
      active: onDaily,
      go: () => router.push('/daily'),
    },
    {
      key: 'projects', label: 'Проєкти', icon: FolderKanban,
      active: section === 'projects',
      go: () => { setSection('projects'); router.push('/board') },
    },
  ]

  return (
    <>
    <div className="flex h-full flex-shrink-0">
      {/* Icon rail */}
      <div className="w-[68px] bg-[#0b0d12] border-r border-white/5 flex flex-col items-center py-4 gap-1.5 flex-shrink-0">
        <div className="w-9 h-9 bg-teal-500 rounded-xl flex items-center justify-center mb-2">
          <span className="text-white font-bold text-sm">G</span>
        </div>
        {railItems.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              onClick={item.go}
              className={`w-14 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-colors ${
                item.active ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={18} />
              <span className="text-[9px] font-medium">{item.label}</span>
            </button>
          )
        })}
        {onDaily && (
          <div className="mt-auto">
            <ThemeToggle variant="sidebar" />
          </div>
        )}
      </div>

      {/* On «Мій день» only the icon rail stays — no section panel */}
      {!onDaily && (
      <aside
        className="relative bg-[#0f1117] text-white flex flex-col overflow-hidden border-r border-white/5 flex-shrink-0"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 transition-colors ${resizing ? 'bg-teal-500/60' : 'hover:bg-teal-500/40'}`}
          title="Потягніть, щоб змінити ширину"
        />

        {/* Header */}
        <div className="px-4 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Gudrix</p>
              <p className="text-gray-500 text-xs">Cowork Space</p>
            </div>
            <ThemeToggle variant="sidebar" />
          </div>
        </div>

        {/* ── FINANCE SECTION ───────────────────────────────── */}
        {section === 'finance' && (
          <>
            <nav className="px-3 py-2 border-b border-white/5 flex-shrink-0">
              {financeNav.map(item => {
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

            <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
              <div>
                <p className="text-xs text-gray-400 mb-1">Всього на рахунках</p>
                <p className="text-2xl font-bold">{fmtEUR(totalUSD)}</p>
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
                              ≈ {fmtEUR(toEUR(account.balance, account.currency))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => setEditingAccount(account)}
                          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-white transition-all ml-1"
                          title="Редагувати рахунок"
                        >
                          <Pencil size={11} />
                        </button>
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
                    <span className="text-teal-400">{fmtEUR(plannedIncome)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Витрати</span>
                    <span className="text-red-400">{fmtEUR(plannedExpense)}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── PROJECTS SECTION ──────────────────────────────── */}
        {section === 'projects' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
              <button
                onClick={toggleProjectsCollapsed}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white font-medium uppercase tracking-wide transition-colors min-w-0"
                title={projectsCollapsed ? 'Розгорнути список проєктів' : 'Згорнути список проєктів'}
              >
                {projectsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                Проєкти
                {projectsCollapsed && pmProjects.length > 0 && (
                  <span className="text-[10px] text-gray-600 normal-case tracking-normal">({pmProjects.length})</span>
                )}
                {projectsCollapsed && pmProjects.some(p => {
                  const u = chatUnread[p.id]
                  return u?.team || u?.client
                }) && (
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse flex-shrink-0" title="Нове повідомлення в чаті проєкту" />
                )}
              </button>
              <button
                onClick={() => { setAddingPm(true); if (projectsCollapsed) toggleProjectsCollapsed() }}
                className="text-gray-500 hover:text-white transition-colors p-0.5 rounded"
                title="Новий проєкт"
              >
                <Plus size={14} />
              </button>
            </div>

            {addingPm && (
              <div className="px-3 py-2 border-b border-white/5 flex-shrink-0">
                <input
                  autoFocus
                  value={newPmName}
                  onChange={e => setNewPmName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createPmProject()
                    if (e.key === 'Escape') { setAddingPm(false); setNewPmName('') }
                  }}
                  onBlur={() => { if (!newPmName.trim()) setAddingPm(false) }}
                  placeholder="Назва проєкту..."
                  className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400 placeholder-gray-500"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={createPmProject}
                    className="flex-1 text-xs bg-teal-500 hover:bg-teal-600 text-white rounded-lg py-1.5 transition-colors"
                  >
                    Створити
                  </button>
                  <button
                    onClick={() => { setAddingPm(false); setNewPmName('') }}
                    className="flex-1 text-xs text-gray-400 hover:text-white bg-white/5 rounded-lg py-1.5 transition-colors"
                  >
                    Скасувати
                  </button>
                </div>
              </div>
            )}

            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {/* Team admin link */}
              <button
                onClick={() => router.push('/team-admin')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-2 text-left ${
                  pathname === '/team-admin' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Users size={13} className="flex-shrink-0" />
                <span>Команда</span>
              </button>

              {/* Discord-style hub with every project + general chat */}
              <button
                onClick={() => router.push('/chats')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-2 text-left ${
                  pathname.startsWith('/chats') ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <MessageSquare size={13} className="flex-shrink-0" />
                <span>Чати</span>
                {(() => {
                  const total = Object.values(chatUnread).reduce((s, u) => s + u.teamCount + u.clientCount, 0)
                  if (total === 0) return null
                  return (
                    <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-white bg-teal-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center" title="Нові повідомлення">
                      {total > 99 ? '99+' : total}
                    </span>
                  )
                })()}
              </button>

              {/* Per-member task queues with estimates */}
              <button
                onClick={() => router.push('/workload')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-2 text-left ${
                  pathname.startsWith('/workload') ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Gauge size={13} className="flex-shrink-0" />
                <span>Завантаженість</span>
              </button>

              <div className="border-t border-white/5 mb-2" />

              {pmProjects.length === 0 && !addingPm && !projectsCollapsed && (
                <button
                  onClick={() => setAddingPm(true)}
                  className="w-full text-xs text-gray-500 hover:text-gray-300 py-2 text-left transition-colors"
                >
                  + Створити перший проєкт
                </button>
              )}
              {!projectsCollapsed && pmProjects.map(p => {
                const isActive = pathname.startsWith(`/board/${p.id}`)
                const u = chatUnread[p.id]
                return (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/board/${p.id}`)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 text-left ${
                      isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Circle size={8} fill={p.color ?? '#14b8a6'} color={p.color ?? '#14b8a6'} className="flex-shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {(() => {
                      const count = (u?.teamCount ?? 0) + (u?.clientCount ?? 0)
                      if (count === 0) return null
                      return (
                        <span
                          className={`ml-auto flex-shrink-0 text-[10px] font-bold text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
                            u?.clientNew ? 'bg-amber-500 animate-pulse' : 'bg-teal-500'
                          }`}
                          title={u?.clientNew ? 'Клієнт написав у чат' : 'Нові повідомлення в чаті'}
                        >
                          {count > 99 ? '99+' : count}
                        </span>
                      )
                    })()}
                  </button>
                )
              })}

              {/* General team chats — not tied to any project */}
              <div className="flex items-center justify-between mt-4 mb-1 px-3">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Чати</p>
                <button
                  onClick={createGeneralChat}
                  className="text-gray-500 hover:text-white transition-colors p-0.5 rounded"
                  title="Новий чат"
                >
                  <Plus size={12} />
                </button>
              </div>
              {generalChats.length === 0 && (
                <button
                  onClick={createGeneralChat}
                  className="w-full text-xs text-gray-500 hover:text-gray-300 py-1.5 px-3 text-left transition-colors"
                >
                  + Створити чат з командою
                </button>
              )}
              {generalChats.map(c => {
                const gc = chatUnread[`chat:${c.id}`]?.teamCount ?? 0
                return (
                <button
                  key={c.id}
                  onClick={() => setOpenChat(c)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 text-left ${
                    openChat?.id === c.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Hash size={12} className="flex-shrink-0 text-teal-400" />
                  <span className="truncate">{c.name}</span>
                  {gc > 0 && (
                    <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-white bg-teal-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {gc > 99 ? '99+' : gc}
                    </span>
                  )}
                </button>
                )
              })}
            </nav>
          </div>
        )}
      </aside>
      )}
      </div>

      {openChat && (
        <GeneralChat
          chat={openChat}
          sender={{ type: 'admin', name: 'Ivan' }}
          onClose={() => setOpenChat(null)}
          onDeleted={() => { setGeneralChats(prev => prev.filter(c => c.id !== openChat.id)) }}
        />
      )}

      <AddAccountModal
        open={addAccountOpen || !!editingAccount}
        account={editingAccount}
        onClose={() => { setAddAccountOpen(false); setEditingAccount(null) }}
        onSuccess={() => { setAddAccountOpen(false); setEditingAccount(null); fetchAccounts() }}
      />
    </>
  )
}
