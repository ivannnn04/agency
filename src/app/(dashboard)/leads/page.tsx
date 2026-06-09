'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, X, ChevronDown, ChevronUp, Edit2, Trash2, Users, Settings, Check, Download } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Manager { id: string; name: string; email: string; is_active: boolean; created_at: string }
interface Lead {
  id: string; lead_name: string; date: string; country: string | null
  request_text: string | null; cover_letter: string | null; account: string
  status: 'sent' | 'reply' | 'call' | 'sale'
  phase_sent: boolean; phase_reply: boolean; phase_call: boolean; phase_sale: boolean
  validated: boolean; manager_id: string; created_at: string
  ping_1_done?: boolean; ping_2_done?: boolean; ping_3_done?: boolean
  job_closed?: boolean; job_closed_at?: string
  lead_managers?: { name: string } | null
}

// ── Earnings helpers ────────────────────────────────────────────────────────────

const PHASE_AMOUNTS = { sent: 0.5, reply: 2, call: 3, sale: 10 }

function calcEarnings(lead: Pick<Lead, 'phase_sent' | 'phase_reply' | 'phase_call' | 'phase_sale'>) {
  return (lead.phase_sent ? PHASE_AMOUNTS.sent : 0)
    + (lead.phase_reply ? PHASE_AMOUNTS.reply : 0)
    + (lead.phase_call  ? PHASE_AMOUNTS.call  : 0)
    + (lead.phase_sale  ? PHASE_AMOUNTS.sale  : 0)
}

function getPingLevel(lead: Lead): 1 | 2 | 3 | null {
  if (lead.status !== 'sent') return null
  const h = (Date.now() - new Date(lead.created_at).getTime()) / 3_600_000
  if (!lead.ping_1_done && h >= 24) return 1
  if (lead.ping_1_done && !lead.ping_2_done && h >= 48) return 2
  if (lead.ping_2_done && !lead.ping_3_done && h >= 72) return 3
  return null
}
const PING_COLORS = ['', 'bg-blue-100 text-blue-700', 'bg-amber-100 text-amber-700', 'bg-red-100 text-red-700']

const STATUS_ORDER = ['sent', 'reply', 'call', 'sale'] as const
const STATUS_LABELS: Record<string, string> = { sent: 'Надіслано', reply: 'Відповідь', call: 'Дзвінок', sale: 'Продаж' }
const STATUS_COLORS: Record<string, string> = {
  sent:  'bg-gray-100 text-gray-600',
  reply: 'bg-blue-100 text-blue-700',
  call:  'bg-amber-100 text-amber-700',
  sale:  'bg-teal-100 text-teal-700',
}

// ── Admin Leads Page ───────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads, setLeads]       = useState<Lead[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [loading, setLoading]   = useState(true)

  // Filters
  const [filterManager, setFilterManager] = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterFrom, setFilterFrom]       = useState('')
  const [filterTo, setFilterTo]           = useState('')

  // Panels
  const [managersOpen, setManagersOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [newManager, setNewManager]     = useState({ name: '', email: '', password: '' })
  const [newAccount, setNewAccount]     = useState('')
  const [saving, setSaving]             = useState(false)
  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [activeTab, setActiveTab]       = useState<'leads' | 'pings'>('leads')
  const [showClosedStats, setShowClosedStats] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: m }, { data: a }] = await Promise.all([
      supabase.from('leads').select('*, lead_managers(name)').order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('lead_managers').select('id,name,email,is_active,created_at').order('name'),
      supabase.from('outreach_accounts').select('name').order('name'),
    ])
    if (l) setLeads(l as Lead[])
    if (m) setManagers(m)
    if (a) setAccounts(a.map((x: any) => x.name))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const pingLeads = leads.filter(l => !l.job_closed && getPingLevel(l) !== null)

  function getWeekStart() {
    const d = new Date()
    const day = d.getDay()
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
    d.setHours(0, 0, 0, 0)
    return d
  }
  const weekStart = getWeekStart()
  const closedLeads = leads.filter(l => l.job_closed).sort((a, b) =>
    new Date(b.job_closed_at ?? 0).getTime() - new Date(a.job_closed_at ?? 0).getTime()
  )
  const closedThisWeek = closedLeads.filter(l => l.job_closed_at && new Date(l.job_closed_at) >= weekStart)

  // Filtered leads
  const filtered = leads.filter(l => {
    if (filterManager && l.manager_id !== filterManager) return false
    if (filterStatus  && l.status !== filterStatus)       return false
    if (filterAccount && l.account !== filterAccount)     return false
    if (filterFrom    && l.date < filterFrom)             return false
    if (filterTo      && l.date > filterTo)               return false
    return true
  })

  // Stats
  const total  = filtered.length
  const sent   = filtered.filter(l => l.phase_sent).length
  const replied = filtered.filter(l => l.phase_reply).length
  const called  = filtered.filter(l => l.phase_call).length
  const sold    = filtered.filter(l => l.phase_sale).length
  const pct = (n: number) => total ? Math.round(n / total * 100) : 0

  const totalEarned = filtered.reduce((s, l) => s + calcEarnings(l), 0)

  async function setStatus(lead: Lead, status: Lead['status']) {
    const idx = STATUS_ORDER.indexOf(status)
    const phases = {
      phase_reply: idx >= STATUS_ORDER.indexOf('reply'),
      phase_call:  idx >= STATUS_ORDER.indexOf('call'),
      phase_sale:  idx >= STATUS_ORDER.indexOf('sale'),
    }
    await supabase.from('leads').update({ status, ...phases }).eq('id', lead.id)
    fetchAll()
  }

  async function toggleValidated(lead: Lead) {
    await supabase.from('leads').update({ validated: !lead.validated }).eq('id', lead.id)
    fetchAll()
  }

  async function deleteLead(id: string) {
    await supabase.from('leads').delete().eq('id', id)
    fetchAll()
  }

  async function markPing(lead: Lead) {
    const level = getPingLevel(lead)
    if (!level) return
    await supabase.from('leads').update({ [`ping_${level}_done`]: true }).eq('id', lead.id)
    fetchAll()
  }

  async function closeLead(lead: Lead) {
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, job_closed: true } : l))
    const { error } = await supabase
      .from('leads')
      .update({ job_closed: true, job_closed_at: new Date().toISOString() })
      .eq('id', lead.id)
    if (error) fetchAll()
  }

  function exportCSV() {
    const rows = [
      ['Дата', 'Лід', 'Країна', 'Акаунт', 'Менеджер', 'Статус', 'Запит / клієнт', 'Листа (Cover Letter)', 'Заробіток ($)', 'Валідовано'],
      ...filtered.map(l => [
        l.date,
        l.lead_name,
        l.country ?? '',
        l.account,
        l.lead_managers?.name ?? '',
        STATUS_LABELS[l.status],
        l.request_text ?? '',
        l.cover_letter ?? '',
        calcEarnings(l).toFixed(2),
        l.validated ? 'Так' : 'Ні',
      ]),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const from = filterFrom || 'початок'
    const to   = filterTo   || 'кінець'
    a.download = `leads-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function createManager() {
    if (!newManager.name.trim() || !newManager.email.trim() || !newManager.password.trim()) return
    setSaving(true)
    const res = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newManager),
    })
    setSaving(false)
    if (res.ok) { setNewManager({ name: '', email: '', password: '' }); fetchAll() }
    else { const { error } = await res.json(); alert(error || 'Помилка') }
  }

  async function toggleActive(mgr: Manager) {
    await fetch(`/api/managers/${mgr.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !mgr.is_active }),
    })
    fetchAll()
  }

  async function deleteManager(id: string) {
    await fetch(`/api/managers/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  async function addAccount() {
    if (!newAccount.trim()) return
    await supabase.from('outreach_accounts').insert({ name: newAccount.trim().toUpperCase() })
    setNewAccount('')
    fetchAll()
  }

  async function deleteAccount(name: string) {
    await supabase.from('outreach_accounts').delete().eq('name', name)
    fetchAll()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ліди</h1>
          <p className="text-sm text-gray-500 mt-0.5">Лідогенерація команди</p>
        </div>
        <button onClick={exportCSV} disabled={filtered.length === 0}
          className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Download size={14} /> Експорт CSV
        </button>
      </div>

      {/* Manager performance cards */}
      {managers.length > 0 && leads.length > 0 && (() => {
        const mgrStats = managers
          .map(mgr => {
            const ml     = leads.filter(l => l.manager_id === mgr.id)
            const sent   = ml.length
            const r      = ml.filter(l => l.phase_reply).length
            const c      = ml.filter(l => l.phase_call).length
            const s      = ml.filter(l => l.phase_sale).length
            const earned = ml.reduce((sum, l) => sum + calcEarnings(l), 0)
            const replyPct = sent ? Math.round(r / sent * 100) : 0
            const callPct  = sent ? Math.round(c / sent * 100) : 0
            const salePct  = sent ? Math.round(s / sent * 100) : 0
            const score    = replyPct * 0.3 + callPct * 0.3 + salePct * 0.4
            return { mgr, sent, r, c, s, earned, replyPct, callPct, salePct, score }
          })
          .filter(x => x.sent > 0)
          .sort((a, b) => b.score - a.score)
        if (!mgrStats.length) return null
        const medals = ['🥇', '🥈', '🥉']
        return (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Ефективність менеджерів</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mgrStats.map(({ mgr, sent, r, c, s, earned, replyPct, callPct, salePct }, i) => (
                <div key={mgr.id} className={`rounded-xl border p-4 ${i === 0 ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">{medals[i] ?? ''}</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-800 leading-tight">{mgr.name}</p>
                        {!mgr.is_active && (
                          <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded">неактивний</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-gray-900">${earned.toFixed(2)}</p>
                      <p className="text-[11px] text-gray-400">{sent} лідів</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-blue-50 rounded-lg px-2 py-2 text-center">
                      <p className="text-[10px] text-blue-500 font-medium mb-0.5">Відповідь</p>
                      <p className="text-lg font-bold text-blue-700 leading-tight">{replyPct}%</p>
                      <p className="text-[10px] text-gray-400">{r}/{sent}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg px-2 py-2 text-center">
                      <p className="text-[10px] text-amber-500 font-medium mb-0.5">Дзвінок</p>
                      <p className="text-lg font-bold text-amber-700 leading-tight">{callPct}%</p>
                      <p className="text-[10px] text-gray-400">{c}/{sent}</p>
                    </div>
                    <div className="bg-teal-50 rounded-lg px-2 py-2 text-center">
                      <p className="text-[10px] text-teal-500 font-medium mb-0.5">Продаж</p>
                      <p className="text-lg font-bold text-teal-700 leading-tight">{salePct}%</p>
                      <p className="text-[10px] text-gray-400">{s}/{sent}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-400 via-amber-400 to-teal-400 transition-all"
                      style={{ width: `${Math.max(replyPct, callPct, salePct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Closed jobs stats panel */}
      <div className="mb-6">
        <button
          onClick={() => setShowClosedStats(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">🔒</span>
            <span className="font-medium text-gray-800">Закриті вакансії</span>
            <span className="text-gray-400 text-xs">{closedLeads.length} всього · {closedThisWeek.length} цього тижня</span>
          </div>
          {showClosedStats ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {showClosedStats && (
          <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Цього тижня по менеджерах</p>
              <div className="flex flex-wrap gap-3">
                {managers.map(mgr => {
                  const count = closedThisWeek.filter(l => l.manager_id === mgr.id).length
                  if (!count) return null
                  return (
                    <div key={mgr.id} className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium text-gray-800">{mgr.name}</span>
                      <span className="text-xl font-bold text-red-600">{count}</span>
                    </div>
                  )
                })}
                {closedThisWeek.length === 0 && (
                  <p className="text-sm text-gray-400">Жодної закритої вакансії цього тижня</p>
                )}
              </div>
            </div>
            {closedLeads.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Останні закриті</p>
                </div>
                {closedLeads.slice(0, 10).map((lead, i) => (
                  <div key={lead.id} className={`${i > 0 ? 'border-t border-gray-50' : ''} px-4 py-2.5 flex items-center gap-3`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{lead.lead_name}</p>
                      <p className="text-xs text-gray-400">{lead.lead_managers?.name ?? '—'} · {lead.account}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                      {lead.job_closed_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(lead.job_closed_at).toLocaleDateString('uk-UA')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-gray-900 text-white rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Всього лідів</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-xs text-gray-500 mb-1">Відповідь</p>
          <p className="text-2xl font-bold text-blue-700">{pct(replied)}%</p>
          <p className="text-xs text-gray-400">{replied} з {sent}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <p className="text-xs text-gray-500 mb-1">Дзвінок</p>
          <p className="text-2xl font-bold text-amber-700">{pct(called)}%</p>
          <p className="text-xs text-gray-400">{called} з {sent}</p>
        </div>
        <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
          <p className="text-xs text-gray-500 mb-1">Продаж</p>
          <p className="text-2xl font-bold text-teal-700">{pct(sold)}%</p>
          <p className="text-xs text-gray-400">{sold} з {sent}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Нараховано</p>
          <p className="text-2xl font-bold text-gray-900">${totalEarned.toFixed(2)}</p>
        </div>
      </div>

      {/* Managers panel */}
      <div className="border border-gray-200 rounded-xl mb-4 overflow-hidden">
        <button onClick={() => setManagersOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-2 text-sm">
            <Users size={15} className="text-gray-500" />
            <span className="font-medium text-gray-800">Менеджери</span>
            <span className="text-gray-400">{managers.length}</span>
          </div>
          {managersOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {managersOpen && (
          <div className="border-t border-gray-100">
            {managers.map(mgr => {
              const mgrLeads    = leads.filter(l => l.manager_id === mgr.id)
              const mgrEarned   = mgrLeads.reduce((s, l) => s + calcEarnings(l), 0)
              return (
                <div key={mgr.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 group">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 flex items-center gap-2">
                      {mgr.name}
                      {!mgr.is_active && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">неактивний</span>}
                    </p>
                    <p className="text-xs text-gray-400">{mgr.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-700">${mgrEarned.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{mgrLeads.length} лідів</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toggleActive(mgr)}
                      title={mgr.is_active ? 'Деактивувати' : 'Активувати'}
                      className="text-gray-400 hover:text-gray-700 p-1 rounded transition-colors text-xs">
                      {mgr.is_active ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => deleteManager(mgr.id)}
                      className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Add manager form */}
            <div className="px-4 py-3 bg-gray-50 flex gap-2 flex-wrap">
              <input placeholder="Ім'я" value={newManager.name}
                onChange={e => setNewManager(p => ({ ...p, name: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 w-36" />
              <input placeholder="Email" type="email" value={newManager.email}
                onChange={e => setNewManager(p => ({ ...p, email: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 flex-1 min-w-36" />
              <input placeholder="Пароль" type="password" value={newManager.password}
                onChange={e => setNewManager(p => ({ ...p, password: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 w-36" />
              <button onClick={createManager} disabled={saving}
                className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
                <Plus size={14} /> Додати
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Accounts panel */}
      <div className="border border-gray-200 rounded-xl mb-6 overflow-hidden">
        <button onClick={() => setAccountsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-2 text-sm">
            <Settings size={15} className="text-gray-500" />
            <span className="font-medium text-gray-800">Акаунти для аутрічу</span>
            <span className="text-gray-400">{accounts.length}</span>
          </div>
          {accountsOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {accountsOpen && (
          <div className="border-t border-gray-100 p-4 flex flex-wrap gap-2">
            {accounts.map(a => (
              <span key={a} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-lg font-medium">
                {a}
                <button onClick={() => deleteAccount(a)} className="text-gray-400 hover:text-red-500 ml-1 transition-colors">
                  <X size={12} />
                </button>
              </span>
            ))}
            <div className="flex gap-2">
              <input placeholder="Новий акаунт" value={newAccount}
                onChange={e => setNewAccount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addAccount() }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 w-40" />
              <button onClick={addAccount}
                className="flex items-center gap-1 bg-gray-900 hover:bg-gray-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors">
                <Plus size={13} /> Додати
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        <button onClick={() => setActiveTab('leads')}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'leads' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          Ліди
        </button>
        <button onClick={() => setActiveTab('pings')}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'pings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          Пінги
          {pingLeads.length > 0 && (
            <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold leading-none">
              {pingLeads.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Ping tab ── */}
      {activeTab === 'pings' && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          {loading && <p className="text-center py-10 text-gray-400 text-sm">Завантаження...</p>}
          {!loading && pingLeads.length === 0 && (
            <div className="text-center py-14 text-gray-400">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm">Немає лідів для пінгування</p>
              <p className="text-xs mt-1 text-gray-300">Ліди з'являться тут через 24г після надсилання</p>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              {pingLeads.length > 0 && (
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Пінг</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Лід</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Акаунт</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Менеджер</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Надіслано</th>
                  <th className="py-3 px-4" />
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pingLeads.map(lead => {
                const level = getPingLevel(lead)!
                const h = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 3_600_000)
                return (
                  <tr key={lead.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${PING_COLORS[level]}`}>
                        Пінг {level}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-800">{lead.lead_name}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">{lead.account}</span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">{lead.lead_managers?.name ?? '—'}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{h}г тому</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => closeLead(lead)}
                          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap">
                          Вакансія закрита
                        </button>
                        <button onClick={() => markPing(lead)}
                          className="bg-gray-900 hover:bg-gray-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap">
                          Запінгував ✓
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Leads tab ── */}
      {activeTab === 'leads' && <>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4">
        <select value={filterManager} onChange={e => setFilterManager(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
          <option value="">Всі менеджери</option>
          {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
          <option value="">Всі статуси</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
          <option value="">Всі акаунти</option>
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
        {(filterManager || filterStatus || filterAccount || filterFrom || filterTo) && (
          <button onClick={() => { setFilterManager(''); setFilterStatus(''); setFilterAccount(''); setFilterFrom(''); setFilterTo('') }}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 px-2">
            <X size={14} /> Скинути
          </button>
        )}
      </div>

      {/* Leads table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Дата</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Лід</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Країна</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Акаунт</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Менеджер</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Статус</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium text-xs">Заробіток</th>
              <th className="text-center py-3 px-4 text-gray-500 font-medium text-xs">Валід.</th>
              <th className="w-10 py-3 px-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Завантаження...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Немає лідів</td></tr>
            )}
            {filtered.map(lead => (
              <>
                <tr key={lead.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group cursor-pointer"
                  onClick={() => setExpandedLead(e => e === lead.id ? null : lead.id)}>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(lead.date).toLocaleDateString('uk-UA')}
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-800 max-w-48 truncate">{lead.lead_name}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{lead.country || '—'}</td>
                  <td className="py-3 px-4">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">{lead.account}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-600 text-xs">{lead.lead_managers?.name ?? '—'}</td>
                  <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                    <select
                      value={lead.status}
                      onChange={e => setStatus(lead, e.target.value as Lead['status'])}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer ${STATUS_COLORS[lead.status]}`}>
                      {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-700">
                    ${calcEarnings(lead).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                    <button onClick={() => toggleValidated(lead)}
                      className={`w-5 h-5 rounded flex items-center justify-center mx-auto transition-colors ${
                        lead.validated ? 'bg-teal-500 text-white' : 'border-2 border-gray-300 hover:border-teal-400'
                      }`}>
                      {lead.validated && <Check size={11} />}
                    </button>
                  </td>
                  <td className="py-3 px-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => deleteLead(lead.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 rounded transition-all">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
                {expandedLead === lead.id && (
                  <tr key={`${lead.id}-expand`} className="border-b border-gray-100">
                    <td colSpan={9} className="px-4 py-3 bg-gray-50/50">
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {lead.request_text && (
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Запит / клієнт</p>
                            <p className="text-gray-700 whitespace-pre-wrap">{lead.request_text}</p>
                          </div>
                        )}
                        {lead.cover_letter && (
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Листа</p>
                            <p className="text-gray-700 whitespace-pre-wrap">{lead.cover_letter}</p>
                          </div>
                        )}
                        {!lead.request_text && !lead.cover_letter && (
                          <p className="text-gray-400 col-span-2">Немає деталей</p>
                        )}
                      </div>
                      {/* Phase tracker */}
                      <div className="flex items-center gap-3 mt-3">
                        {(['sent', 'reply', 'call', 'sale'] as const).map(phase => (
                          <span key={phase} className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 ${
                            lead[`phase_${phase}`] ? STATUS_COLORS[phase] : 'bg-gray-100 text-gray-400'
                          }`}>
                            {lead[`phase_${phase}`] && <Check size={9} />}
                            {STATUS_LABELS[phase]} {lead[`phase_${phase}`] ? `+$${PHASE_AMOUNTS[phase]}` : ''}
                          </span>
                        ))}
                        <span className="text-xs text-gray-500 ml-auto font-semibold">
                          = ${calcEarnings(lead).toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>


      </>}{/* end leads tab */}
    </div>
  )
}
