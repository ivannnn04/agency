'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, X, ChevronDown, ChevronUp, Edit2, Trash2, Users, Settings, Check } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Manager { id: string; name: string; email: string; is_active: boolean; created_at: string }
interface Lead {
  id: string; lead_name: string; date: string; country: string | null
  request_text: string | null; cover_letter: string | null; account: string
  status: 'sent' | 'reply' | 'call' | 'sale'
  phase_sent: boolean; phase_reply: boolean; phase_call: boolean; phase_sale: boolean
  validated: boolean; manager_id: string; created_at: string
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
    const phases: Partial<Lead> = {}
    if (STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf('reply')) phases.phase_reply = true
    if (STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf('call'))  phases.phase_call  = true
    if (STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf('sale'))  phases.phase_sale  = true
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

      {/* Per-manager summary */}
      {managers.length > 0 && leads.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Показники по менеджерах</h2>
          <div className="grid grid-cols-2 gap-3">
            {managers.map(mgr => {
              const ml  = leads.filter(l => l.manager_id === mgr.id)
              const r   = ml.filter(l => l.phase_reply).length
              const c   = ml.filter(l => l.phase_call).length
              const s   = ml.filter(l => l.phase_sale).length
              const earned = ml.reduce((sum, l) => sum + calcEarnings(l), 0)
              if (!ml.length) return null
              return (
                <div key={mgr.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-gray-800">{mgr.name}</p>
                    <p className="font-bold text-gray-900">${earned.toFixed(2)}</p>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>{ml.length} надіслано</span>
                    <span className="text-blue-600">{r} відповідей ({ml.length ? Math.round(r/ml.length*100) : 0}%)</span>
                    <span className="text-amber-600">{c} дзвінків</span>
                    <span className="text-teal-600">{s} продажів</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
