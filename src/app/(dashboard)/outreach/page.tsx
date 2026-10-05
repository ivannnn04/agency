'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Send, ExternalLink, Trash2, ChevronDown, ChevronUp, Plus, Loader2 } from 'lucide-react'

// Admin-only outreach log: every proposal the browser Claude agents send on
// Dribbble/Behance lands here via /api/outreach. Statuses are tracked by hand.

interface Proposal {
  id: string
  source: string
  job_title: string
  job_url: string | null
  client_name: string | null
  budget: string | null
  cover_letter: string
  status: 'sent' | 'replied' | 'won' | 'lost'
  notes: string | null
  sent_at: string
}

const SOURCE_STYLE: Record<string, string> = {
  dribbble: 'bg-[#ea4c89]/10 text-[#ea4c89] border-[#ea4c89]/30',
  behance: 'bg-[#1769ff]/10 text-[#1769ff] border-[#1769ff]/30',
  other: 'bg-gray-100 text-gray-500 border-gray-200',
}
const SOURCE_LABEL: Record<string, string> = { dribbble: 'Dribbble', behance: 'Behance' }

const STATUS_LABEL: Record<Proposal['status'], string> = {
  sent: 'Надіслано', replied: 'Відповіли', won: 'Виграли', lost: 'Програли',
}
const STATUS_STYLE: Record<Proposal['status'], string> = {
  sent: 'bg-gray-100 text-gray-600',
  replied: 'bg-amber-50 text-amber-700',
  won: 'bg-teal-50 text-teal-700',
  lost: 'bg-red-50 text-red-500',
}

export default function OutreachPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ source: 'dribbble', job_title: '', job_url: '', cover_letter: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error } = await supabase
      .from('outreach_proposals')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(500)
    setLoading(false)
    if (error) { setDbError('Запусти міграцію outreach_migration.sql'); return }
    setProposals((data ?? []) as Proposal[])
  }

  async function setStatus(p: Proposal, status: Proposal['status']) {
    setProposals(prev => prev.map(x => x.id === p.id ? { ...x, status } : x))
    await supabase.from('outreach_proposals').update({ status }).eq('id', p.id)
  }

  async function remove(p: Proposal) {
    if (!window.confirm(`Видалити пропозал «${p.job_title}»?`)) return
    setProposals(prev => prev.filter(x => x.id !== p.id))
    await supabase.from('outreach_proposals').delete().eq('id', p.id)
  }

  async function addManual() {
    if (!draft.job_title.trim() || saving) return
    setSaving(true)
    const { data, error } = await supabase
      .from('outreach_proposals')
      .insert({
        source: draft.source,
        job_title: draft.job_title.trim(),
        job_url: draft.job_url.trim() || null,
        cover_letter: draft.cover_letter.trim(),
      })
      .select()
      .single()
    setSaving(false)
    if (error) { setDbError('Не вдалося зберегти: ' + error.message); return }
    setProposals(prev => [data as Proposal, ...prev])
    setDraft({ source: 'dribbble', job_title: '', job_url: '', cover_letter: '' })
    setAdding(false)
  }

  const filtered = proposals.filter(p =>
    (sourceFilter === 'all' || p.source === sourceFilter) &&
    (statusFilter === 'all' || p.status === statusFilter)
  )

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const stats = {
    total: proposals.length,
    week: proposals.filter(p => new Date(p.sent_at).getTime() > weekAgo).length,
    replied: proposals.filter(p => p.status === 'replied' || p.status === 'won').length,
    won: proposals.filter(p => p.status === 'won').length,
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
      active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
    }`

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Аутріч</h1>
        <button
          onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-3.5 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Додати вручну
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-5">
        Пропозали, які Claude-агенти подають на Dribbble і Behance — заносяться сюди автоматично через API.
      </p>

      {dbError && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3 mb-4">{dbError}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          ['Всього', stats.total], ['За 7 днів', stats.week],
          ['Відповіли', stats.replied], ['Виграли', stats.won],
        ].map(([label, n]) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
            <p className="text-2xl font-bold text-gray-900">{n}</p>
            <p className="text-[11px] text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Manual add */}
      {adding && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5 flex flex-col gap-2.5">
          <div className="flex gap-2 flex-wrap">
            <select
              value={draft.source}
              onChange={e => setDraft(d => ({ ...d, source: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="dribbble">Dribbble</option>
              <option value="behance">Behance</option>
              <option value="other">Інше</option>
            </select>
            <input
              value={draft.job_title}
              onChange={e => setDraft(d => ({ ...d, job_title: e.target.value }))}
              placeholder="Назва джоби..."
              className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={draft.job_url}
              onChange={e => setDraft(d => ({ ...d, job_url: e.target.value }))}
              placeholder="Лінк на джобу (необов'язково)"
              className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={draft.cover_letter}
            onChange={e => setDraft(d => ({ ...d, cover_letter: e.target.value }))}
            placeholder="Текст пропозала..."
            rows={3}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={addManual}
              disabled={saving || !draft.job_title.trim()}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Зберегти
            </button>
            <button onClick={() => setAdding(false)} className="text-sm text-gray-400 hover:text-gray-600 px-2">
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button className={chip(sourceFilter === 'all')} onClick={() => setSourceFilter('all')}>Всі джерела</button>
        <button className={chip(sourceFilter === 'dribbble')} onClick={() => setSourceFilter('dribbble')}>Dribbble</button>
        <button className={chip(sourceFilter === 'behance')} onClick={() => setSourceFilter('behance')}>Behance</button>
        <span className="w-px h-5 bg-gray-200 mx-1" />
        <button className={chip(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>Всі статуси</button>
        {(Object.keys(STATUS_LABEL) as Proposal['status'][]).map(s => (
          <button key={s} className={chip(statusFilter === s)} onClick={() => setStatusFilter(s)}>{STATUS_LABEL[s]}</button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-xs text-gray-300 py-6">Завантаження...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-300 py-6">
          {proposals.length === 0 ? 'Ще немає пропозалів — агенти занесуть їх сюди автоматично' : 'Нічого не підходить під фільтри'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(p => {
            const open = expanded.has(p.id)
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${SOURCE_STYLE[p.source] ?? SOURCE_STYLE.other}`}>
                    {SOURCE_LABEL[p.source] ?? p.source}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.job_title}</p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(p.sent_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {p.client_name && <> · {p.client_name}</>}
                      {p.budget && <> · {p.budget}</>}
                    </p>
                  </div>
                  <select
                    value={p.status}
                    onChange={e => setStatus(p, e.target.value as Proposal['status'])}
                    className={`text-xs font-medium rounded-lg px-2 py-1.5 border-0 cursor-pointer ${STATUS_STYLE[p.status]}`}
                  >
                    {(Object.keys(STATUS_LABEL) as Proposal['status'][]).map(s => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  {p.job_url && (
                    <a href={p.job_url} target="_blank" rel="noreferrer"
                      className="text-gray-400 hover:text-gray-600 p-1.5" title="Відкрити джобу">
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {p.cover_letter && (
                    <button
                      onClick={() => setExpanded(prev => {
                        const n = new Set(prev)
                        if (n.has(p.id)) n.delete(p.id); else n.add(p.id)
                        return n
                      })}
                      className="text-gray-400 hover:text-gray-600 p-1.5"
                      title={open ? 'Згорнути' : 'Показати пропозал'}
                    >
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}
                  <button onClick={() => remove(p)} className="text-gray-300 hover:text-red-400 p-1.5" title="Видалити">
                    <Trash2 size={14} />
                  </button>
                </div>
                {open && p.cover_letter && (
                  <div className="mt-3 pt-3 border-t border-gray-50 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {p.cover_letter}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
