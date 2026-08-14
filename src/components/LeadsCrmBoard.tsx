'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Plus, X, Trash2, Mail, StickyNote, Send, ExternalLink, DollarSign,
} from 'lucide-react'

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

const COLUMNS: { key: CrmLead['status']; label: string; color: string }[] = [
  { key: 'new',         label: 'НОВІ',        color: '#3b82f6' },
  { key: 'contacted',   label: 'НА ЗВʼЯЗКУ',  color: '#06b6d4' },
  { key: 'negotiation', label: 'ПЕРЕГОВОРИ',  color: '#f59e0b' },
  { key: 'proposal',    label: 'ПРОПОЗИЦІЯ',  color: '#8b5cf6' },
  { key: 'won',         label: 'WON',         color: '#10b981' },
  { key: 'lost',        label: 'LOST',        color: '#ef4444' },
]

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function fmtAmount(lead: CrmLead) {
  if (lead.amount == null) return null
  return `${CURRENCY_SYMBOL[lead.currency]}${lead.amount.toLocaleString('en-US')}`
}

export default function LeadsCrmBoard() {
  const [leads, setLeads] = useState<CrmLead[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CrmLead | null>(null)
  const [addingIn, setAddingIn] = useState<CrmLead['status'] | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('crm_leads').select('*').order('created_at', { ascending: false })
    if (error) setDbError('Таблиця crm_leads не знайдена. Запусти supabase/crm_leads_migration.sql у Supabase SQL Editor.')
    else if (data) setLeads(data as CrmLead[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

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
    await supabase.from('crm_leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev)
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
      if (proj) projectPatch = { project_id: proj.id }
    }

    await updateLead(id, { status, ...projectPatch })
  }

  async function deleteLead(id: string) {
    if (!confirm('Видалити ліда разом з історією листів?')) return
    await supabase.from('crm_leads').delete().eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  if (dbError) return (
    <div className="text-center py-16">
      <p className="text-red-500 font-medium mb-2">Потрібна міграція бази даних</p>
      <p className="text-sm text-gray-500">{dbError}</p>
    </div>
  )

  if (loading) return <p className="text-center py-16 text-gray-400 text-sm">Завантаження...</p>

  return (
    <div className="flex h-full">
      <div className="flex gap-3 overflow-x-auto flex-1 items-start pb-4">
        {COLUMNS.map(col => {
          const colLeads = leads.filter(l => l.status === col.key)
          const colTotal = colLeads.reduce((s, l) => s + (l.amount ?? 0), 0)
          return (
            <div
              key={col.key}
              className={`flex-shrink-0 w-[260px] flex flex-col rounded-xl transition-colors p-1 ${dragOverCol === col.key ? 'bg-teal-50/70 ring-2 ring-teal-300' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.key) }}
              onDragLeave={() => setDragOverCol(prev => prev === col.key ? null : prev)}
              onDrop={e => {
                e.preventDefault()
                setDragOverCol(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) moveLead(id, col.key)
              }}
            >
              <div className="flex items-center justify-between px-1 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-xs font-bold tracking-wide" style={{ color: col.color }}>{col.label}</span>
                  <span className="text-xs text-gray-400">{colLeads.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  {colTotal > 0 && <span className="text-[10px] text-gray-400 font-medium">${colTotal.toLocaleString('en-US')}</span>}
                  <button onClick={() => setAddingIn(col.key)} className="text-gray-400 hover:text-gray-600 p-0.5 rounded"><Plus size={13} /></button>
                </div>
              </div>

              <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-320px)] min-h-[40px]">
                {addingIn === col.key && (
                  <AddLeadForm onSave={p => addLead(col.key, p)} onCancel={() => setAddingIn(null)} />
                )}
                {colLeads.map(lead => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', lead.id); e.dataTransfer.effectAllowed = 'move' }}
                    onClick={() => setSelected(lead)}
                    className="bg-white rounded-xl border border-gray-100 p-3 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer active:cursor-grabbing select-none group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 leading-snug">{lead.name}</p>
                      <button
                        onClick={e => { e.stopPropagation(); deleteLead(lead.id) }}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2">
                      {fmtAmount(lead) && (
                        <span className="text-xs font-semibold text-teal-700">{fmtAmount(lead)}</span>
                      )}
                      {lead.channel && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">{lead.channel}</span>
                      )}
                      {lead.email && <Mail size={11} className="text-gray-300" />}
                      {lead.notes && <StickyNote size={11} className="text-gray-300" />}
                    </div>
                    {lead.status === 'won' && lead.project_id && (
                      <a
                        href={`/board/${lead.project_id}`}
                        onClick={e => e.stopPropagation()}
                        className="mt-2 flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-700 font-medium"
                      >
                        <ExternalLink size={10} /> Проєкт створено — відкрити борду
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdate={patch => updateLead(selected.id, patch)}
          onMove={status => moveLead(selected.id, status)}
          onDelete={() => deleteLead(selected.id)}
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

function LeadDrawer({ lead, onClose, onUpdate, onMove, onDelete }: {
  lead: CrmLead
  onClose: () => void
  onUpdate: (patch: Partial<CrmLead>) => void
  onMove: (status: CrmLead['status']) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(lead.name)
  const [email, setEmail] = useState(lead.email ?? '')
  const [amount, setAmount] = useState(lead.amount != null ? String(lead.amount) : '')
  const [channel, setChannel] = useState(lead.channel ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')

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
    <div className="w-[420px] min-w-[420px] border-l border-gray-100 bg-white flex flex-col h-full overflow-hidden ml-3">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <select
          value={lead.status}
          onChange={e => onMove(e.target.value as CrmLead['status'])}
          className="text-xs font-bold tracking-wide px-2.5 py-1 rounded-full focus:outline-none cursor-pointer"
          style={{ backgroundColor: (col?.color ?? '#6b7280') + '22', color: col?.color ?? '#6b7280' }}
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
  )
}
