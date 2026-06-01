'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { Plus, X, ChevronDown, Check } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

type LeadStatus = 'sent' | 'reply' | 'call' | 'sale'

interface Lead {
  id: string; lead_name: string; date: string; country: string | null
  request_text: string | null; cover_letter: string | null; account: string
  status: LeadStatus
  phase_sent: boolean; phase_reply: boolean; phase_call: boolean; phase_sale: boolean
  validated: boolean; manager_id: string; created_at: string
}

const PHASE_AMOUNTS: Record<string, number> = { sent: 0.5, reply: 2, call: 3, sale: 10 }
const STATUS_ORDER: LeadStatus[]            = ['sent', 'reply', 'call', 'sale']
const STATUS_LABELS: Record<string, string> = { sent: 'Надіслано', reply: 'Відповідь', call: 'Дзвінок', sale: 'Продаж' }
const STATUS_COLORS: Record<string, string> = {
  sent:  'bg-gray-100 text-gray-600',
  reply: 'bg-blue-100 text-blue-700',
  call:  'bg-amber-100 text-amber-700',
  sale:  'bg-teal-100 text-teal-700',
}

function calcEarnings(lead: Pick<Lead, 'phase_sent' | 'phase_reply' | 'phase_call' | 'phase_sale'>) {
  return (lead.phase_sent  ? PHASE_AMOUNTS.sent  : 0)
       + (lead.phase_reply ? PHASE_AMOUNTS.reply : 0)
       + (lead.phase_call  ? PHASE_AMOUNTS.call  : 0)
       + (lead.phase_sale  ? PHASE_AMOUNTS.sale  : 0)
}

const today = () => new Date().toISOString().split('T')[0]

// ── Form defaults ──────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    lead_name: '', date: today(), country: '',
    request_text: '', cover_letter: '', account: '',
  }
}

// ── Manager Page ───────────────────────────────────────────────────────────────

export default function MyLeadsPage() {
  const { data: session } = useSession()
  const managerId = session?.user?.managerId

  const [leads, setLeads]       = useState<Lead[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [loading, setLoading]   = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm]         = useState(emptyForm())
  const [saving, setSaving]     = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!managerId) return
    setLoading(true)
    const [{ data: l }, { data: a }] = await Promise.all([
      supabase.from('leads')
        .select('*')
        .eq('manager_id', managerId)
        .eq('is_earnings_paid', false)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('outreach_accounts').select('name').order('name'),
    ])
    if (l) setLeads(l as Lead[])
    if (a) setAccounts(a.map((x: any) => x.name))
    if (a && !form.account && a.length > 0) setForm(f => ({ ...f, account: a[0].name }))
    setLoading(false)
  }, [managerId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const totalEarned = leads.reduce((s, l) => s + calcEarnings(l), 0)
  const replied = leads.filter(l => l.phase_reply).length
  const called  = leads.filter(l => l.phase_call).length
  const sold    = leads.filter(l => l.phase_sale).length

  async function submitLead(e: React.FormEvent) {
    e.preventDefault()
    if (!form.lead_name.trim() || !form.account || !managerId) return
    setSaving(true)
    await supabase.from('leads').insert({
      lead_name:    form.lead_name.trim(),
      date:         form.date || today(),
      country:      form.country.trim() || null,
      request_text: form.request_text.trim() || null,
      cover_letter: form.cover_letter.trim() || null,
      account:      form.account,
      manager_id:   managerId,
      status:       'sent',
      phase_sent:   true,
    })
    setSaving(false)
    setForm({ ...emptyForm(), account: form.account, date: form.date })
    setFormOpen(false)
    fetchAll()
  }

  async function setStatus(lead: Lead, status: LeadStatus) {
    const curIdx  = STATUS_ORDER.indexOf(lead.status)
    const nextIdx = STATUS_ORDER.indexOf(status)
    // Only set new phases (never clear existing ones)
    const phases: Partial<Lead> = {}
    if (nextIdx >= STATUS_ORDER.indexOf('reply')) phases.phase_reply = true
    if (nextIdx >= STATUS_ORDER.indexOf('call'))  phases.phase_call  = true
    if (nextIdx >= STATUS_ORDER.indexOf('sale'))  phases.phase_sale  = true
    await supabase.from('leads').update({ status, ...phases }).eq('id', lead.id)
    fetchAll()
  }

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-gray-900 text-white rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Мій заробіток</p>
          <p className="text-2xl font-bold">${totalEarned.toFixed(2)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-xs text-gray-500 mb-1">Відповіді</p>
          <p className="text-2xl font-bold text-blue-700">{replied}</p>
          <p className="text-xs text-gray-400">+${(replied * PHASE_AMOUNTS.reply).toFixed(2)}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <p className="text-xs text-gray-500 mb-1">Дзвінки</p>
          <p className="text-2xl font-bold text-amber-700">{called}</p>
          <p className="text-xs text-gray-400">+${(called * PHASE_AMOUNTS.call).toFixed(2)}</p>
        </div>
        <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
          <p className="text-xs text-gray-500 mb-1">Продажі</p>
          <p className="text-2xl font-bold text-teal-700">{sold}</p>
          <p className="text-xs text-gray-400">+${(sold * PHASE_AMOUNTS.sale).toFixed(2)}</p>
        </div>
      </div>

      {/* Phase earnings legend */}
      <div className="flex items-center gap-3 mb-5 text-xs text-gray-500">
        <span className="font-medium text-gray-600">Ставки:</span>
        <span className="bg-gray-100 px-2 py-1 rounded">Надіслано $0.50</span>
        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">Відповідь +$2.00</span>
        <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded">Дзвінок +$3.00</span>
        <span className="bg-teal-100 text-teal-700 px-2 py-1 rounded">Продаж +$10.00</span>
      </div>

      {/* Add button / form */}
      {!formOpen ? (
        <button onClick={() => setFormOpen(true)}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors mb-5">
          <Plus size={15} /> Додати лід
        </button>
      ) : (
        <form onSubmit={submitLead}
          className="border border-gray-200 rounded-xl p-5 mb-5 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Новий лід</h2>
            <button type="button" onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Назва ліда *</label>
              <input required value={form.lead_name}
                onChange={e => setForm(f => ({ ...f, lead_name: e.target.value }))}
                placeholder="Ім'я / компанія"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Дата</label>
              <input type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Країна</label>
              <input value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                placeholder="США, Велика Британія..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Акаунт *</label>
              <select required value={form.account}
                onChange={e => setForm(f => ({ ...f, account: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none bg-white focus:ring-2 focus:ring-gray-900">
                <option value="">Обрати...</option>
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Запит / клієнт</label>
            <textarea rows={3} value={form.request_text}
              onChange={e => setForm(f => ({ ...f, request_text: e.target.value }))}
              placeholder="Опис ліда, що шукає, бюджет..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Листа (Cover Letter)</label>
            <textarea rows={4} value={form.cover_letter}
              onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))}
              placeholder="Текст відправленого листа..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setFormOpen(false)}
              className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving || !form.lead_name.trim() || !form.account}
              className="bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
          </div>
        </form>
      )}

      {/* Leads table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Дата</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Лід</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Країна</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Акаунт</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Статус</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium text-xs">Заробіток</th>
              <th className="text-center py-3 px-4 text-gray-500 font-medium text-xs">Валід.</th>
              <th className="w-8 py-3 px-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">Завантаження...</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">
                <p className="text-3xl mb-2">📬</p>
                <p>Ще немає лідів. Додайте перший!</p>
              </td></tr>
            )}
            {leads.map(lead => (
              <>
                <tr key={lead.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(e => e === lead.id ? null : lead.id)}>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(lead.date).toLocaleDateString('uk-UA')}
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-800 max-w-48">
                    <span className="truncate block">{lead.lead_name}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{lead.country || '—'}</td>
                  <td className="py-3 px-4">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">{lead.account}</span>
                  </td>
                  <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                    <select
                      value={lead.status}
                      onChange={e => setStatus(lead, e.target.value as LeadStatus)}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer ${STATUS_COLORS[lead.status]}`}>
                      {STATUS_ORDER.map(s => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-700">
                    ${calcEarnings(lead).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {lead.validated
                      ? <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-teal-500 text-white"><Check size={11} /></span>
                      : <span className="inline-block w-5 h-5 rounded border-2 border-gray-200" />}
                  </td>
                  <td className="py-3 px-2">
                    <ChevronDown size={13} className={`text-gray-400 transition-transform ${expanded === lead.id ? 'rotate-180' : ''}`} />
                  </td>
                </tr>
                {expanded === lead.id && (
                  <tr key={`${lead.id}-detail`} className="border-b border-gray-100">
                    <td colSpan={8} className="px-4 py-4 bg-gray-50/50">
                      {/* Phase progress */}
                      <div className="flex items-center gap-2 mb-3">
                        {(['sent', 'reply', 'call', 'sale'] as const).map((phase, idx) => (
                          <span key={phase} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${
                            lead[`phase_${phase}`] ? STATUS_COLORS[phase] : 'bg-gray-100 text-gray-400'
                          }`}>
                            {lead[`phase_${phase}`] && <Check size={9} />}
                            {STATUS_LABELS[phase]}
                            {lead[`phase_${phase}`] && (
                              <span className="font-bold">+${PHASE_AMOUNTS[phase]}</span>
                            )}
                          </span>
                        ))}
                        <span className="ml-auto text-sm font-bold text-gray-700">
                          Разом: ${calcEarnings(lead).toFixed(2)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {lead.request_text && (
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Запит</p>
                            <p className="text-gray-700 whitespace-pre-wrap">{lead.request_text}</p>
                          </div>
                        )}
                        {lead.cover_letter && (
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Листа</p>
                            <p className="text-gray-700 whitespace-pre-wrap">{lead.cover_letter}</p>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
