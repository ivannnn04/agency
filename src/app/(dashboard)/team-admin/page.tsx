'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { Plus, Trash2, Copy, Check, Link, Users } from 'lucide-react'

const COLOR_PALETTE = [
  '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#3b82f6', '#10b981', '#f97316', '#ec4899',
]

export default function TeamAdminPage() {
  const [members, setMembers]   = useState<TeamMember[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [copied, setCopied]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const [name, setName]   = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole]   = useState('designer')
  const [color, setColor] = useState(COLOR_PALETTE[0])

  useEffect(() => { fetchMembers() }, [])

  async function fetchMembers() {
    setLoading(true)
    const { data, error: err } = await supabase.from('team_members').select('*').order('created_at')
    if (err) setError(err.message)
    else if (data) setMembers(data)
    setLoading(false)
  }

  async function addMember() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('team_members').insert({
      name: name.trim(),
      email: email.trim() || null,
      role,
      color,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setName(''); setEmail(''); setRole('designer'); setColor(COLOR_PALETTE[0])
    setShowForm(false)
    fetchMembers()
  }

  async function deleteMember(id: string) {
    await supabase.from('team_members').delete().eq('id', id)
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/team/${token}`
    navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Команда</h1>
          <p className="text-sm text-gray-500 mt-0.5">Управляйте дизайнерами та учасниками команди</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Додати учасника
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-5 p-5 border border-gray-200 rounded-xl bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Новий учасник</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Ім'я *</label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addMember(); if (e.key === 'Escape') setShowForm(false) }}
                placeholder="Ім'я Прізвище"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Роль</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="designer">Дизайнер</option>
                <option value="developer">Розробник</option>
                <option value="manager">Менеджер</option>
                <option value="copywriter">Копірайтер</option>
                <option value="other">Інше</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Колір</label>
              <div className="flex items-center gap-2 mt-1">
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-1 ring-gray-700 scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addMember}
              disabled={saving || !name.trim()}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-700 transition-colors"
            >
              {saving ? 'Збереження...' : 'Додати'}
            </button>
            <button
              onClick={() => { setShowForm(false); setName(''); setEmail('') }}
              className="text-gray-400 hover:text-gray-600 text-sm px-3"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Завантаження...</p>
      ) : members.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-40" />
          <p>Команда порожня. Додайте першого учасника!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map(m => (
            <div
              key={m.id}
              className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-gray-200 bg-white group"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                  style={{ backgroundColor: m.color }}
                >
                  {m.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{m.name}</p>
                  <p className="text-xs text-gray-400">{m.email || m.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Copy link button */}
                <button
                  onClick={() => copyLink(m.access_token)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors hover:border-gray-400"
                  title="Скопіювати посилання для входу"
                >
                  {copied === m.access_token ? (
                    <><Check size={12} className="text-teal-500" /> Скопійовано</>
                  ) : (
                    <><Link size={12} /> Посилання</>
                  )}
                </button>

                <button
                  onClick={() => deleteMember(m.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-1.5 rounded"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      {members.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl">
          <div className="flex items-start gap-2.5">
            <Link size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">Як учасники входять в систему</p>
              <p className="text-xs text-blue-600 mt-1">
                Скопіюйте унікальне посилання кожного учасника і відправте їм. Вони отримають доступ до своїх задач без потреби реєструватися.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
