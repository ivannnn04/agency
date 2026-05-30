'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Project } from '@/types'
import { Plus, Trash2, FolderOpen } from 'lucide-react'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data, error: err } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    else if (data) setProjects(data)
    setLoading(false)
  }

  async function addProject() {
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('projects').insert({ name: newName.trim(), status: 'active' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setNewName('')
    setShowForm(false)
    fetchProjects()
  }

  async function deleteProject(id: string) {
    await supabase.from('projects').delete().eq('id', id)
    fetchProjects()
  }

  async function toggleStatus(project: Project) {
    await supabase.from('projects')
      .update({ status: project.status === 'active' ? 'inactive' : 'active' })
      .eq('id', project.id)
    fetchProjects()
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Проекти</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Новий проект
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-4 border border-gray-200 rounded-xl bg-gray-50 flex items-center gap-3">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addProject(); if (e.key === 'Escape') { setShowForm(false); setNewName('') } }}
            placeholder="Назва проекту"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            onClick={addProject}
            disabled={saving || !newName.trim()}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            Додати
          </button>
          <button
            onClick={() => { setShowForm(false); setNewName('') }}
            className="text-gray-400 hover:text-gray-600 text-sm px-2"
          >
            Скасувати
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Завантаження...</p>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
          <p>Немає проектів. Створіть перший!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map(p => (
            <div
              key={p.id}
              className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-gray-200 bg-white group"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-teal-500' : 'bg-gray-300'}`} />
                <span className="text-sm font-medium text-gray-900">{p.name}</span>
                <button
                  onClick={() => toggleStatus(p)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    p.status === 'active'
                      ? 'border-teal-200 text-teal-600 hover:bg-teal-50'
                      : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {p.status === 'active' ? 'Активний' : 'Неактивний'}
                </button>
              </div>
              <button
                onClick={() => deleteProject(p.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-1 rounded"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
