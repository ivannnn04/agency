'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Loader2, Plus, Send, ShieldCheck, Trash2, X } from 'lucide-react'

// Who may sign in to the client workspace. Only emails on this list get in —
// with a password from the invitation or with Google. Everyone else is turned
// away at sign-in.

interface ClientRow {
  id: string
  email: string
  name: string | null
  lang: 'en' | 'uk'
  invited_at: string | null
  created_at: string | null
  last_sign_in_at: string | null
  project_ids: string[]
}
interface ProjectRow { id: string; name: string; color: string | null; status: string | null }

const fmt = (d: string) => new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })

function ProjectPicker({ projects, value, onChange, label }: {
  projects: ProjectRow[]
  value: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const chosen = projects.filter(p => value.includes(p.id))
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 flex-wrap text-left min-h-[34px] border border-gray-200 hover:border-gray-300 rounded-lg px-2 py-1 transition-colors"
      >
        {chosen.length === 0 && <span className="text-sm text-gray-400 px-1">{label ?? 'Без проєктів'}</span>}
        {chosen.map(p => (
          <span key={p.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color ?? '#9ca3af' }} />
            {p.name}
          </span>
        ))}
        <ChevronDown size={13} className="ml-auto text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-72 max-h-72 overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-lg p-1.5">
          {projects.length === 0 && <p className="text-xs text-gray-400 p-2">Проєктів ще немає</p>}
          {projects.map(p => {
            const on = value.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(on ? value.filter(v => v !== p.id) : [...value, p.id])}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700 text-left"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color ?? '#9ca3af' }} />
                <span className="flex-1 truncate">{p.name}</span>
                {on && <Check size={14} className="text-gray-900 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [emails, setEmails] = useState('')
  const [name, setName] = useState('')
  const [newProjects, setNewProjects] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  // New clients get the welcome letter right away unless this is switched off
  const [sendInvite, setSendInvite] = useState(true)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Bumping the counter re-reads the list
  const [nonce, setNonce] = useState(0)
  const load = () => setNonce(n => n + 1)

  useEffect(() => {
    let alive = true
    fetch('/api/clients')
      .then(async res => {
        const d = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(d.error ?? `HTTP ${res.status}`)
        else { setClients(d.clients ?? []); setProjects(d.projects ?? []) }
        setLoading(false)
      })
      .catch(e => { if (alive) { setError((e as Error).message); setLoading(false) } })
    return () => { alive = false }
  }, [nonce])

  async function call(method: string, url: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setError('')
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return null }
    return d
  }

  async function addClients(e: React.FormEvent) {
    e.preventDefault()
    if (!emails.trim() || adding) return
    setAdding(true); setNotice('')
    const d = await call('POST', '/api/clients', { emails, name, projectIds: newProjects })
    if (!d) { setAdding(false); return }
    const added = Number(d.added ?? 0), already = Number(d.already ?? 0)
    const ids = Array.isArray(d.created_ids) ? (d.created_ids as string[]) : []
    let sent = 0
    if (sendInvite) {
      for (const id of ids) {
        const r = await call('POST', '/api/clients/invite', { clientId: id })
        if (r) sent++
      }
    }
    setNotice(
      `Додано: ${added}${already ? ` · уже були у списку: ${already}` : ''}.`
      + (sendInvite ? (added ? ` Вітальний лист надіслано: ${sent} з ${added}.` : '') : ' Лист не надсилався — натисни «Запросити», коли буде час.'),
    )
    setEmails(''); setName(''); setNewProjects([])
    setAdding(false)
    load()
  }

  async function update(id: string, patch: Partial<Pick<ClientRow, 'name' | 'lang'>> & { projectIds?: string[] }) {
    setClients(prev => prev.map(c => c.id === id
      ? { ...c, ...('name' in patch ? { name: patch.name ?? null } : {}), ...(patch.lang ? { lang: patch.lang } : {}), ...(patch.projectIds ? { project_ids: patch.projectIds } : {}) }
      : c))
    const d = await call('PATCH', '/api/clients', { id, ...patch })
    if (!d) load()
  }

  async function invite(c: ClientRow) {
    setInvitingId(c.id); setNotice('')
    const first = projects.find(p => c.project_ids.includes(p.id))
    const d = await call('POST', '/api/clients/invite', { clientId: c.id, projectName: c.project_ids.length === 1 ? first?.name : undefined })
    setInvitingId(null)
    if (!d) return
    setNotice(`Запрошення надіслано на ${c.email}`)
    setClients(prev => prev.map(x => x.id === c.id ? { ...x, invited_at: new Date().toISOString() } : x))
  }

  async function remove(c: ClientRow) {
    if (!confirm(`Забрати доступ у ${c.name || c.email}? Клієнт більше не зможе увійти в кабінет.`)) return
    const d = await call('DELETE', `/api/clients?id=${c.id}`)
    if (d) setClients(prev => prev.filter(x => x.id !== c.id))
  }

  const q = query.trim().toLowerCase()
  const shown = q ? clients.filter(c => c.email.includes(q) || (c.name ?? '').toLowerCase().includes(q)) : clients

  return (
    <div className="p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Клієнти</h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-gray-400" />
            У кабінет клієнта пускає лише емейли з цього списку — з паролем із запрошення або через Google.
          </p>
        </div>
        <Link href="/portal/login" target="_blank" className="text-sm text-gray-500 hover:text-gray-900 underline">Сторінка входу клієнта</Link>
      </div>

      {/* Add */}
      <form onSubmit={addClients} className="bg-white border border-gray-100 rounded-2xl p-4 mb-5 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-3 items-start">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Email — можна кілька через кому або пробіл</label>
          <input
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder="adam@company.com, kate@company.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Імʼя (для одного email)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Adam Taylor"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Проєкти</label>
          <ProjectPicker projects={projects} value={newProjects} onChange={setNewProjects} label="Обрати проєкти" />
        </div>
        <button
          type="submit"
          disabled={!emails.trim() || adding}
          className="lg:mt-5 flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Додати
        </button>
        <label className="lg:col-span-4 flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} className="accent-gray-900" />
          Одразу надіслати клієнту вітальний лист із посиланням у кабінет
        </label>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-3">
          {error} <button onClick={() => setError('')}><X size={14} /></button>
        </p>
      )}
      {notice && (
        <p className="text-sm text-green-700 bg-green-100 rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-3">
          {notice} <button onClick={() => setNotice('')}><X size={14} /></button>
        </p>
      )}

      {/* List */}
      <div className="bg-white border border-gray-100 rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">{clients.length} у списку</p>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Пошук за імʼям або email"
            className="w-64 max-w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 p-6">Завантажую…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">{clients.length === 0 ? 'Список порожній — зараз у кабінет клієнта не може увійти ніхто. Додай перший email вище.' : 'Нічого не знайдено'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[920px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="font-medium px-4 py-2.5 w-[26%]">Клієнт</th>
                  <th className="font-medium px-4 py-2.5">Проєкти</th>
                  <th className="font-medium px-4 py-2.5 w-[130px]">Мова кабінету</th>
                  <th className="font-medium px-4 py-2.5 w-[190px]">Доступ</th>
                  <th className="font-medium px-4 py-2.5 w-[150px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map(c => (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-3">
                      <input
                        defaultValue={c.name ?? ''}
                        placeholder="Імʼя"
                        onBlur={e => { if (e.target.value.trim() !== (c.name ?? '')) update(c.id, { name: e.target.value.trim() }) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="w-full text-sm font-medium text-gray-900 bg-transparent border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-md px-1.5 py-0.5 -ml-1.5 focus:outline-none placeholder:text-gray-300 placeholder:font-normal"
                      />
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{c.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ProjectPicker projects={projects} value={c.project_ids} onChange={ids => update(c.id, { projectIds: ids })} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5">
                        {(['en', 'uk'] as const).map(k => (
                          <button
                            key={k}
                            onClick={() => { if (c.lang !== k) update(c.id, { lang: k }) }}
                            className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${c.lang === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                          >
                            {k === 'en' ? 'EN' : 'UA'}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.last_sign_in_at ? (
                        <><span className="inline-block font-medium text-green-700 bg-green-100 rounded-md px-2 py-0.5">Заходив</span>
                          <p className="text-gray-400 mt-1">останній вхід {fmt(c.last_sign_in_at)}</p></>
                      ) : c.invited_at ? (
                        <><span className="inline-block font-medium text-amber-700 bg-amber-50 rounded-md px-2 py-0.5">Запрошено</span>
                          <p className="text-gray-400 mt-1">{fmt(c.invited_at)} · ще не заходив</p></>
                      ) : (
                        <><span className="inline-block font-medium text-gray-600 bg-gray-100 rounded-md px-2 py-0.5">Не запрошено</span>
                          <p className="text-gray-400 mt-1">може увійти через Google</p></>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => invite(c)}
                          disabled={invitingId === c.id}
                          title="Надіслати вітальний лист із посиланням — клієнт сам встановить пароль"
                          className="flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:border-gray-900 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
                        >
                          {invitingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          {c.invited_at ? 'Ще раз' : 'Запросити'}
                        </button>
                        <button onClick={() => remove(c)} title="Забрати доступ" className="p-1.5 text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
