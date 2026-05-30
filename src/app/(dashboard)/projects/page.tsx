'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Project } from '@/types'
import { Plus, Trash2, FolderOpen, Archive, X, Edit2 } from 'lucide-react'

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export default function ProjectsPage() {
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)
  const [addOpen, setAddOpen]     = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('projects').select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    else if (data) setProjects(data)
    setLoading(false)
  }

  async function deleteProject(id: string) {
    await supabase.from('projects').delete().eq('id', id)
    fetchProjects()
  }

  async function archiveProject(p: Project) {
    await supabase.from('projects')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', p.id)
    fetchProjects()
  }

  async function unarchiveProject(p: Project) {
    await supabase.from('projects')
      .update({ status: 'active', archived_at: null })
      .eq('id', p.id)
    fetchProjects()
  }

  async function toggleStatus(p: Project) {
    await supabase.from('projects')
      .update({ status: p.status === 'active' ? 'inactive' : 'active' })
      .eq('id', p.id)
    fetchProjects()
  }

  const active   = projects.filter(p => p.status !== 'archived')
  const archived = projects.filter(p => p.status === 'archived')

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Проекти</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Новий проект
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Завантаження...</p>
      ) : active.length === 0 && archived.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
          <p>Немає проектів. Створіть перший!</p>
        </div>
      ) : (
        <>
          {/* Active / inactive projects */}
          <div className="flex flex-col gap-2 mb-6">
            {active.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                onEdit={() => setEditProject(p)}
                onToggleStatus={() => toggleStatus(p)}
                onArchive={() => archiveProject(p)}
                onDelete={() => deleteProject(p.id)}
              />
            ))}
          </div>

          {/* Archived section */}
          {archived.length > 0 && (
            <ArchivedSection
              projects={archived}
              onUnarchive={unarchiveProject}
              onDelete={deleteProject}
            />
          )}
        </>
      )}

      {addOpen && (
        <ProjectModal
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); fetchProjects() }}
        />
      )}
      {editProject && (
        <ProjectModal
          project={editProject}
          onClose={() => setEditProject(null)}
          onSuccess={() => { setEditProject(null); fetchProjects() }}
        />
      )}
    </div>
  )
}

// ── Project row ────────────────────────────────────────────────────────────────

function ProjectRow({ project: p, onEdit, onToggleStatus, onArchive, onDelete }: {
  project: Project
  onEdit: () => void
  onToggleStatus: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const sym = CURRENCY_SYMBOL[p.contract_currency ?? 'USD']
  const hasContract = p.contract_amount && p.contract_amount > 0

  return (
    <div className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-gray-200 bg-white group">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status === 'active' ? 'bg-teal-500' : 'bg-gray-300'}`} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-gray-900">{p.name}</span>
          {hasContract && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400">
                Контракт: {sym}{p.contract_amount!.toLocaleString('en-US')}
              </span>
              {(p.received_before_app ?? 0) > 0 && (
                <span className="text-xs text-teal-600">
                  · Отримано: {sym}{p.received_before_app!.toLocaleString('en-US')}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onToggleStatus}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
            p.status === 'active'
              ? 'border-teal-200 text-teal-600 hover:bg-teal-50'
              : 'border-gray-200 text-gray-400 hover:bg-gray-50'
          }`}
        >
          {p.status === 'active' ? 'Активний' : 'Неактивний'}
        </button>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="text-gray-400 hover:text-gray-700 p-1.5 rounded" title="Редагувати">
          <Edit2 size={13} />
        </button>
        <button onClick={onArchive} className="text-gray-400 hover:text-amber-500 p-1.5 rounded" title="Архівувати">
          <Archive size={13} />
        </button>
        <button onClick={onDelete} className="text-gray-400 hover:text-red-400 p-1.5 rounded" title="Видалити">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Archived section ───────────────────────────────────────────────────────────

function ArchivedSection({ projects, onUnarchive, onDelete }: {
  projects: Project[]
  onUnarchive: (p: Project) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1.5 mb-3 transition-colors">
        <Archive size={14} className="text-amber-400" />
        {open ? 'Сховати' : 'Показати'} архів ({projects.length})
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {projects.map(p => (
            <div key={p.id}
              className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50 group opacity-70 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3 min-w-0">
                <Archive size={13} className="text-amber-400 flex-shrink-0" />
                <div>
                  <span className="text-sm font-medium text-gray-700">{p.name}</span>
                  {p.archived_at && (
                    <p className="text-xs text-gray-400">
                      Архівовано {new Date(p.archived_at).toLocaleDateString('uk-UA')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onUnarchive(p)}
                  className="text-xs text-gray-500 hover:text-teal-600 px-2 py-1 rounded border border-gray-200 hover:border-teal-200 transition-colors">
                  Відновити
                </button>
                <button onClick={() => onDelete(p.id)}
                  className="text-gray-400 hover:text-red-400 p-1.5 rounded" title="Видалити назавжди">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add / Edit Project Modal ───────────────────────────────────────────────────

function ProjectModal({ project, onClose, onSuccess }: {
  project?: Project
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit = !!project

  const [name, setName]               = useState(project?.name ?? '')
  const [contractAmount, setContractAmount] = useState(project?.contract_amount ? String(project.contract_amount) : '')
  const [contractCurrency, setContractCurrency] = useState(project?.contract_currency ?? 'USD')
  const [receivedBefore, setReceivedBefore] = useState(project?.received_before_app ? String(project.received_before_app) : '')
  const [error, setError]             = useState('')
  const [saving, setSaving]           = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Введіть назву проекту'); return }
    setSaving(true)

    const payload = {
      name: name.trim(),
      contract_amount: contractAmount ? Number(contractAmount) : null,
      contract_currency: contractCurrency,
      received_before_app: receivedBefore ? Number(receivedBefore) : 0,
    }

    const { error: err } = isEdit
      ? await supabase.from('projects').update(payload).eq('id', project!.id)
      : await supabase.from('projects').insert({ ...payload, status: 'active' })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  const sym = CURRENCY_SYMBOL[contractCurrency]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Редагувати проект' : 'Новий проект'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Назва проекту *</label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              placeholder="Назва"
              value={name} onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Фінансові показники (необовʼязково)</p>
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Сума контракту</label>
                <input
                  type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="0.00"
                  value={contractAmount} onChange={e => setContractAmount(e.target.value)}
                />
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  value={contractCurrency} onChange={e => setContractCurrency(e.target.value)}
                >
                  <option>USD</option><option>EUR</option><option>UAH</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Вже отримано до старту програми
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sym}</span>
                <input
                  type="number" step="0.01" min="0"
                  className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="0.00"
                  value={receivedBefore} onChange={e => setReceivedBefore(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Ця сума не зараховується на рахунок — враховується тільки для розрахунку маржинальності
              </p>
            </div>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : isEdit ? 'Зберегти' : 'Створити'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
