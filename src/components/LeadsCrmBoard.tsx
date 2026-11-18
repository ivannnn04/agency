'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Plus, X, Trash2, Mail, Send, ExternalLink, DollarSign, CircleDollarSign, Radio, Calendar, Building2, UserRound,
  Sparkles, Video,
} from 'lucide-react'
import { FellowBar, Insights, LeadInsightPanel, scoreTone } from '@/components/leads/LeadInsights'

export interface CrmLead {
  id: string
  name: string
  email: string | null
  amount: number | null
  currency: 'USD' | 'EUR' | 'UAH'
  channel: string | null
  status: 'new' | 'contacted' | 'negotiation' | 'proposal' | 'won' | 'lost'
  notes: string | null
  project_id: string | null
  company?: string | null
  contact_name?: string | null
  created_at: string
}

interface LeadEmail {
  id: string
  lead_id: string
  direction: 'out' | 'in'
  subject: string | null
  body: string | null
  to_email: string | null
  from_email: string | null
  sent_at: string
}

const COLUMNS: { key: CrmLead['status']; label: string; chip: string }[] = [
  { key: 'new',         label: 'Нові',        chip: 'bg-red-50 text-red-600' },
  { key: 'contacted',   label: 'На звʼязку',  chip: 'bg-violet-50 text-violet-700' },
  { key: 'negotiation', label: 'Переговори',  chip: 'bg-blue-50 text-blue-700' },
  { key: 'proposal',    label: 'Пропозиція',  chip: 'bg-green-100 text-green-700' },
  { key: 'won',         label: 'Клієнт',      chip: 'bg-amber-50 text-amber-700' },
  { key: 'lost',        label: 'Втрачено',    chip: 'bg-gray-100 text-gray-500' },
]

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

const short = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(Math.round(n))

function fmtAmount(lead: CrmLead) {
  if (lead.amount == null) return null
  return `${CURRENCY_SYMBOL[lead.currency]}${short(lead.amount)}`
}

// The year only when it is not the current one — cards are narrow
function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
}

const SYNC_STALE_MS = 15 * 60_000

function Row({ icon, children, title }: { icon: React.ReactNode; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-gray-700 min-w-0" title={title}>
      <span className="text-gray-300 flex-shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}

function Initial({ text }: { text: string }) {
  return (
    <span className="w-4 h-4 rounded bg-gray-100 text-gray-500 text-[9px] font-bold inline-flex items-center justify-center flex-shrink-0 uppercase">
      {text.trim().charAt(0) || '?'}
    </span>
  )
}

export default function LeadsCrmBoard() {
  const [leads, setLeads] = useState<CrmLead[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addingIn, setAddingIn] = useState<CrmLead['status'] | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsError, setInsightsError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const autoSynced = useRef(false)

  const selected = leads.find(l => l.id === selectedId) ?? null

  const fetchLeads = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const { data, error } = await supabase
      .from('crm_leads').select('*').order('created_at', { ascending: false })
    if (error) setDbError('Таблиця crm_leads не знайдена. Запусти supabase/crm_leads_migration.sql у Supabase SQL Editor.')
    else if (data) setLeads(data as CrmLead[])
    setLoading(false)
  }, [])

  const fetchInsights = useCallback(async (): Promise<Insights | null> => {
    try {
      const res = await fetch('/api/leads/insights')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setInsights(data as Insights)
      setInsightsError('')
      return data as Insights
    } catch (e) {
      setInsightsError((e as Error).message)
      return null
    }
  }, [])

  const refresh = useCallback(() => { fetchLeads(true); fetchInsights() }, [fetchLeads, fetchInsights])

  const syncFellow = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/fellow/sync', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setInsightsError(data.error ?? `HTTP ${res.status}`)
    } catch (e) {
      setInsightsError((e as Error).message)
    }
    setSyncing(false)
    fetchLeads(true)
    fetchInsights()
  }, [fetchLeads, fetchInsights])

  useEffect(() => {
    fetchLeads()
    // Opening the board pulls fresh calls from Fellow when the last sync is stale
    fetchInsights().then(d => {
      if (!d?.fellow.configured || autoSynced.current) return
      const last = d.fellow.last_synced_at ? new Date(d.fellow.last_synced_at).getTime() : 0
      if (Date.now() - last > SYNC_STALE_MS) { autoSynced.current = true; syncFellow() }
    })
  }, [fetchLeads, fetchInsights, syncFellow])

  async function addLead(status: CrmLead['status'], patch: { name: string; email: string; amount: string; channel: string }) {
    const { data, error } = await supabase.from('crm_leads').insert({
      name: patch.name.trim(),
      email: patch.email.trim() || null,
      amount: patch.amount ? Number(patch.amount) : null,
      channel: patch.channel.trim() || null,
      status,
    }).select().single()
    setAddingIn(null)
    if (!error && data) setLeads(prev => [data as CrmLead, ...prev])
  }

  async function updateLead(id: string, patch: Partial<CrmLead>) {
    const { error } = await supabase.from('crm_leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert(`Не збережено: ${error.message}`); return }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  // Move between columns; on first move to `won` the lead becomes a project
  async function moveLead(id: string, status: CrmLead['status']) {
    const lead = leads.find(l => l.id === id)
    if (!lead || lead.status === status) return

    let projectPatch: Partial<CrmLead> = {}
    if (status === 'won' && !lead.project_id) {
      const palette = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#10b981']
      const { data: proj } = await supabase.from('projects').insert({
        name: lead.name,
        status: 'active',
        color: palette[lead.name.length % palette.length],
        contract_amount: lead.amount,
        contract_currency: lead.currency,
      }).select().single()
      if (proj) {
        projectPatch = { project_id: proj.id }
        window.dispatchEvent(new Event('gudrix:projects-changed'))
      }
    }

    await updateLead(id, { status, ...projectPatch })
  }

  async function deleteLead(id: string) {
    if (!confirm('Видалити ліда разом з історією листів?')) return
    await supabase.from('crm_leads').delete().eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  if (dbError) return (
    <div className="text-center py-16">
      <p className="text-red-500 font-medium mb-2">Потрібна міграція бази даних</p>
      <p className="text-sm text-gray-500">{dbError}</p>
    </div>
  )

  if (loading) return <p className="text-center py-16 text-gray-400 text-sm">Завантаження...</p>

  return (
    <div>
      <FellowBar
        insights={insights}
        error={insightsError}
        leads={leads.filter(l => l.status !== 'lost')}
        syncing={syncing}
        onSync={syncFellow}
        onChanged={refresh}
      />

      <div className="flex gap-1.5 overflow-x-auto items-start pb-4">
        {COLUMNS.map(col => {
          const colLeads = leads.filter(l => l.status === col.key)
          const colTotal = colLeads.reduce((s, l) => s + (l.amount ?? 0), 0)
          return (
            <div
              key={col.key}
              className={`flex-1 min-w-[204px] max-w-[340px] flex flex-col rounded-2xl transition-colors p-1 ${dragOverCol === col.key ? 'bg-gray-100 ring-2 ring-gray-200' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.key) }}
              onDragLeave={() => setDragOverCol(prev => prev === col.key ? null : prev)}
              onDrop={e => {
                e.preventDefault()
                setDragOverCol(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) moveLead(id, col.key)
              }}
            >
              <div className="flex items-center gap-2.5 px-1 mb-2.5">
                <span className={`text-[13px] font-medium px-2 py-0.5 rounded-md ${col.chip}`}>{col.label}</span>
                <span className="text-[13px] text-gray-400">{colTotal > 0 ? short(colTotal) : colLeads.length}</span>
              </div>

              <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-300px)] min-h-[40px]">
                {colLeads.map(lead => {
                  const score = insights?.scores[lead.id]
                  const calls = insights?.meetingStats[lead.id]
                  const tone = score ? scoreTone(score.win_probability) : null
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('text/plain', lead.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => setSelectedId(lead.id)}
                      className={`bg-white rounded-xl border px-2.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer active:cursor-grabbing select-none group flex flex-col gap-2 ${
                        selectedId === lead.id ? 'border-gray-400' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Initial text={lead.name} />
                        <p className="text-sm font-medium text-gray-900 truncate flex-1">{lead.name}</p>
                        <button
                          onClick={e => { e.stopPropagation(); deleteLead(lead.id) }}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {fmtAmount(lead) && <Row icon={<CircleDollarSign size={14} />}>{fmtAmount(lead)}</Row>}
                      {lead.channel && <Row icon={<Radio size={14} />}>{lead.channel}</Row>}
                      <Row icon={<Calendar size={14} />} title={calls?.last ? 'Останній дзвінок' : 'Створено'}>
                        {fmtDate(calls?.last ?? lead.created_at)}
                      </Row>
                      {lead.company && (
                        <Row icon={<Building2 size={14} />}>
                          <span className="inline-flex items-center gap-1.5"><Initial text={lead.company} />{lead.company}</span>
                        </Row>
                      )}
                      {(lead.contact_name || lead.email) && (
                        <Row icon={<UserRound size={14} />}>
                          <span className="inline-flex items-center gap-1.5 bg-gray-50 rounded px-1 -mx-1">
                            <Initial text={lead.contact_name || lead.email || ''} />{lead.contact_name || lead.email}
                          </span>
                        </Row>
                      )}
                      {(score || calls) && (
                        <div className="flex items-center gap-2 pt-1.5 border-t border-gray-50">
                          {score && tone && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${tone.bg} ${tone.text}`} title={score.next_step || 'AI-оцінка шансу виграти'}>
                              <Sparkles size={10} /> {score.win_probability}%
                            </span>
                          )}
                          {calls && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                              <Video size={11} /> {calls.count}
                            </span>
                          )}
                        </div>
                      )}
                      {lead.status === 'won' && lead.project_id && (
                        <a
                          href={`/board/${lead.project_id}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 font-medium"
                        >
                          <ExternalLink size={10} /> Відкрити борду проєкту
                        </a>
                      )}
                    </div>
                  )
                })}
                {addingIn === col.key ? (
                  <AddLeadForm onSave={p => addLead(col.key, p)} onCancel={() => setAddingIn(null)} />
                ) : (
                  <button
                    onClick={() => setAddingIn(col.key)}
                    className="flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-left"
                  >
                    <Plus size={13} /> Новий
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelectedId(null)}
          onUpdate={patch => updateLead(selected.id, patch)}
          onMove={status => moveLead(selected.id, status)}
          onDelete={() => deleteLead(selected.id)}
          onInsightsChanged={refresh}
        />
      )}
    </div>
  )
}

// ── Inline add form ────────────────────────────────────────────────────────────

function AddLeadForm({ onSave, onCancel }: {
  onSave: (p: { name: string; email: string; amount: string; channel: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState('')

  function save() {
    if (!name.trim()) return
    onSave({ name, email, amount, channel })
  }

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-3 flex flex-col gap-2">
      <input autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
        placeholder="Імʼя ліда / компанія *"
        className="text-sm text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
        className="text-sm text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <div className="flex gap-2">
        <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Сума $"
          className="w-1/2 text-sm text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="Канал"
          className="w-1/2 text-sm text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={!name.trim()}
          className="flex-1 text-xs bg-gray-900 text-white rounded-lg py-1.5 hover:bg-gray-700 disabled:opacity-40">Додати</button>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 px-2"><X size={14} /></button>
      </div>
    </div>
  )
}

// ── Lead drawer ────────────────────────────────────────────────────────────────

function LeadDrawer({ lead, onClose, onUpdate, onMove, onDelete, onInsightsChanged }: {
  lead: CrmLead
  onClose: () => void
  onUpdate: (patch: Partial<CrmLead>) => void
  onMove: (status: CrmLead['status']) => void
  onDelete: () => void
  onInsightsChanged: () => void
}) {
  const [name, setName] = useState(lead.name)
  const [email, setEmail] = useState(lead.email ?? '')
  const [amount, setAmount] = useState(lead.amount != null ? String(lead.amount) : '')
  const [channel, setChannel] = useState(lead.channel ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [company, setCompany] = useState(lead.company ?? '')
  const [contact, setContact] = useState(lead.contact_name ?? '')

  const [emails, setEmails] = useState<LeadEmail[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    setName(lead.name)
    setEmail(lead.email ?? '')
    setAmount(lead.amount != null ? String(lead.amount) : '')
    setChannel(lead.channel ?? '')
    setNotes(lead.notes ?? '')
    setCompany(lead.company ?? '')
    setContact(lead.contact_name ?? '')
    setComposeOpen(false); setSubject(''); setBody(''); setSendError('')
    supabase.from('lead_emails').select('*').eq('lead_id', lead.id).order('sent_at', { ascending: false })
      .then(({ data }) => { if (data) setEmails(data as LeadEmail[]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  async function sendEmail() {
    if (!email.trim() || !subject.trim() || !body.trim()) return
    setSending(true)
    setSendError('')
    const res = await fetch('/api/leads/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: lead.id, to: email.trim(), subject: subject.trim(), body }),
    })
    setSending(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Помилка надсилання' }))
      setSendError(error)
      return
    }
    const sent = await res.json()
    setEmails(prev => [sent, ...prev])
    setComposeOpen(false); setSubject(''); setBody('')
  }

  const col = COLUMNS.find(c => c.key === lead.status)

  return (
    <>
    <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[540px] border-l border-gray-100 bg-white flex flex-col overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <select
          value={lead.status}
          onChange={e => onMove(e.target.value as CrmLead['status'])}
          className={`text-[13px] font-medium px-2 py-1 rounded-md focus:outline-none cursor-pointer ${col?.chip ?? 'bg-gray-100 text-gray-500'}`}
        >
          {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <button onClick={onDelete} className="text-gray-300 hover:text-red-400 p-1.5 rounded"><Trash2 size={14} /></button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {/* Name */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { const v = name.trim(); if (v && v !== lead.name) onUpdate({ name: v }) }}
          className="text-lg font-semibold text-gray-900 focus:outline-none w-full"
          placeholder="Імʼя ліда"
        />

        {lead.status === 'won' && lead.project_id && (
          <a href={`/board/${lead.project_id}`}
            className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
            <ExternalLink size={13} /> Проєкт створено — відкрити борду
          </a>
        )}

        {/* Fields */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0">Email</span>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => { const v = email.trim() || null; if (v !== lead.email) onUpdate({ email: v }) }}
              placeholder="lead@example.com"
              className="flex-1 text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0">Сума проєкту</span>
            <div className="flex items-center gap-1.5 flex-1">
              <DollarSign size={13} className="text-gray-300" />
              <input
                type="number" step="0.01" min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                onBlur={() => { const v = amount ? Number(amount) : null; if (v !== lead.amount) onUpdate({ amount: v }) }}
                placeholder="0.00"
                className="w-28 text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 focus:outline-none"
              />
              <select
                value={lead.currency}
                onChange={e => onUpdate({ currency: e.target.value as CrmLead['currency'] })}
                className="text-sm text-gray-600 bg-transparent focus:outline-none cursor-pointer"
              >
                <option>USD</option><option>EUR</option><option>UAH</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0">Компанія</span>
            <input
              value={company}
              onChange={e => setCompany(e.target.value)}
              onBlur={() => { const v = company.trim() || null; if (v !== (lead.company ?? null)) onUpdate({ company: v }) }}
              placeholder="Назва компанії"
              className="flex-1 text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0">Контакт</span>
            <input
              value={contact}
              onChange={e => setContact(e.target.value)}
              onBlur={() => { const v = contact.trim() || null; if (v !== (lead.contact_name ?? null)) onUpdate({ contact_name: v }) }}
              placeholder="Імʼя контактної особи"
              className="flex-1 text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0">Канал</span>
            <input
              value={channel}
              onChange={e => setChannel(e.target.value)}
              onBlur={() => { const v = channel.trim() || null; if (v !== lead.channel) onUpdate({ channel: v }) }}
              placeholder="UpWork / LinkedIn / рекомендація..."
              className="flex-1 text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 focus:outline-none"
            />
          </div>
        </div>

        <LeadInsightPanel leadId={lead.id} onChanged={onInsightsChanged} />

        {/* Notes */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Нотатки</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => { const v = notes.trim() || null; if (v !== lead.notes) onUpdate({ notes: v }) }}
            rows={4}
            placeholder="Нотатки по ліду..."
            className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none leading-relaxed"
          />
        </div>

        {/* Emails */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Листування</p>
            <button
              onClick={() => setComposeOpen(v => !v)}
              disabled={!email.trim()}
              title={email.trim() ? 'Написати лист' : 'Спочатку вкажіть email ліда'}
              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 disabled:opacity-40 font-medium"
            >
              <Mail size={12} /> Написати
            </button>
          </div>

          {composeOpen && (
            <div className="border border-gray-200 rounded-xl p-3 mb-2 flex flex-col gap-2 bg-gray-50/50">
              <p className="text-[11px] text-gray-400">Кому: <span className="text-gray-600">{email}</span></p>
              <input
                value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Тема листа"
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              />
              <textarea
                value={body} onChange={e => setBody(e.target.value)}
                rows={5} placeholder="Текст листа..."
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none bg-white"
              />
              {sendError && <p className="text-xs text-red-500">{sendError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={sendEmail}
                  disabled={sending || !subject.trim() || !body.trim()}
                  className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-xs font-medium"
                >
                  <Send size={11} /> {sending ? 'Надсилання...' : 'Надіслати'}
                </button>
                <button onClick={() => setComposeOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Скасувати</button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {emails.length === 0 && !composeOpen && (
              <p className="text-xs text-gray-300">Ще немає листів</p>
            )}
            {emails.map(m => (
              <div key={m.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${m.direction === 'out' ? 'bg-blue-50 text-blue-600' : 'bg-teal-50 text-teal-600'}`}>
                    {m.direction === 'out' ? '→ Надіслано' : '← Отримано'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(m.sent_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-800">{m.subject}</p>
                {m.body && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-4">{m.body}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
