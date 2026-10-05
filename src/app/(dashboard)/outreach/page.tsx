'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Send, ExternalLink, Trash2, ChevronDown, ChevronUp, Plus, Loader2, X,
  FileSpreadsheet, UserPlus, Check,
} from 'lucide-react'

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
  lead_id: string | null
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
  const router = useRouter()
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ source: 'dribbble', job_title: '', job_url: '', cover_letter: '' })
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<Proposal | null>(null)
  const [converting, setConverting] = useState(false)
  const [exporting, setExporting] = useState(false)

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
    setDetail(d => d?.id === p.id ? null : d)
    await supabase.from('outreach_proposals').delete().eq('id', p.id)
  }

  // Manually promote a proposal to a CRM lead — it appears on the leads
  // board (status "new") with the source as its channel tag
  async function convertToLead(p: Proposal) {
    if (p.lead_id || converting) return
    setConverting(true)
    const channel = SOURCE_LABEL[p.source] ?? p.source
    const notesParts = [p.job_url, p.budget && `Бюджет: ${p.budget}`, p.cover_letter?.slice(0, 500)]
    const { data: lead, error } = await supabase
      .from('crm_leads')
      .insert({
        name: p.client_name || p.job_title,
        channel,
        status: 'new',
        notes: notesParts.filter(Boolean).join('\n\n'),
      })
      .select('id')
      .single()
    if (error) {
      setConverting(false)
      setDbError('Не вдалося створити лід: ' + error.message)
      return
    }
    const { error: linkErr } = await supabase
      .from('outreach_proposals')
      .update({ lead_id: lead.id })
      .eq('id', p.id)
    setConverting(false)
    if (linkErr && linkErr.message.includes('lead_id')) {
      setDbError('Лід створено, але запусти міграцію outreach_migration.sql (колонка lead_id), щоб бачити зв’язок')
    }
    setProposals(prev => prev.map(x => x.id === p.id ? { ...x, lead_id: lead.id } : x))
    setDetail(d => d?.id === p.id ? { ...d, lead_id: lead.id } : d)
  }

  // Everything (respecting nothing but the table itself) → one .xlsx sheet
  async function exportExcel() {
    if (exporting) return
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const rows = proposals.map(p => ({
        'Джерело': SOURCE_LABEL[p.source] ?? p.source,
        'Джоба': p.job_title,
        'Лінк': p.job_url ?? '',
        'Клієнт': p.client_name ?? '',
        'Бюджет': p.budget ?? '',
        'Статус': STATUS_LABEL[p.status] ?? p.status,
        'Надіслано': new Date(p.sent_at).toLocaleString('uk-UA'),
        'В лідах': p.lead_id ? 'так' : '',
        'Пропозал': p.cover_letter ?? '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [
        { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 20 }, { wch: 12 },
        { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 80 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Outreach')
      XLSX.writeFile(wb, `gudrix-outreach-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally {
      setExporting(false)
    }
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
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={exporting || proposals.length === 0}
            className="flex items-center gap-1.5 bg-white border border-gray-200 hover:border-gray-300 disabled:opacity-40 text-gray-700 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
          </button>
          <button
            onClick={() => setAdding(v => !v)}
            className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-3.5 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={14} /> Додати вручну
          </button>
        </div>
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
              <div key={p.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 hover:border-gray-200 transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${SOURCE_STYLE[p.source] ?? SOURCE_STYLE.other}`}>
                    {SOURCE_LABEL[p.source] ?? p.source}
                  </span>
                  <button onClick={() => setDetail(p)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <p className="text-sm font-medium text-gray-900 truncate hover:underline">{p.job_title}</p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(p.sent_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {p.client_name && <> · {p.client_name}</>}
                      {p.budget && <> · {p.budget}</>}
                    </p>
                  </button>
                  {p.lead_id && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md" title="Вже на дошці лідів">
                      <Check size={10} /> ЛІД
                    </span>
                  )}
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

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${SOURCE_STYLE[detail.source] ?? SOURCE_STYLE.other}`}>
                    {SOURCE_LABEL[detail.source] ?? detail.source}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${STATUS_STYLE[detail.status]}`}>
                    {STATUS_LABEL[detail.status]}
                  </span>
                  {detail.lead_id && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md">
                      <Check size={10} /> на дошці лідів
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-gray-900 break-words">{detail.job_title}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(detail.sent_at).toLocaleString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {detail.client_name && <> · {detail.client_name}</>}
                  {detail.budget && <> · {detail.budget}</>}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detail.job_url && (
                <a
                  href={detail.job_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:underline mb-4 break-all"
                >
                  <ExternalLink size={13} className="flex-shrink-0" /> {detail.job_url}
                </a>
              )}
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Надісланий пропозал</p>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-xl p-4">
                {detail.cover_letter || '— без тексту —'}
              </div>
            </div>

            <div className="flex items-center gap-2 p-5 border-t border-gray-100 flex-wrap">
              {detail.lead_id ? (
                <button
                  onClick={() => router.push('/leads')}
                  className="flex items-center gap-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Check size={14} /> Відкрити дошку лідів
                </button>
              ) : (
                <button
                  onClick={() => convertToLead(detail)}
                  disabled={converting}
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  {converting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Конвертувати в лід
                </button>
              )}
              <select
                value={detail.status}
                onChange={e => { setStatus(detail, e.target.value as Proposal['status']); setDetail({ ...detail, status: e.target.value as Proposal['status'] }) }}
                className={`text-sm font-medium rounded-xl px-3 py-2.5 border-0 cursor-pointer ${STATUS_STYLE[detail.status]}`}
              >
                {(Object.keys(STATUS_LABEL) as Proposal['status'][]).map(s => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button
                onClick={() => remove(detail)}
                className="ml-auto text-gray-300 hover:text-red-400 p-2 transition-colors"
                title="Видалити"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
