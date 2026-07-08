'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { TeamMember } from '@/types'
import { Plus, Trash2, Users, Eye, EyeOff } from 'lucide-react'

const COLOR_PALETTE = [
  '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#3b82f6', '#10b981', '#f97316', '#ec4899',
]

export default function TeamAdminPage() {
  const [members, setMembers]   = useState<TeamMember[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [role, setRole]           = useState('designer')
  const [rate, setRate]           = useState('')
  const [color, setColor]         = useState(COLOR_PALETTE[0])

  // Inline rate editing
  const [editingRateId, setEditingRateId] = useState<string | null>(null)
  const [editRateValue, setEditRateValue] = useState('')

  useEffect(() => { fetchMembers() }, [])

  async function fetchMembers() {
    setLoading(true)
    const { data, error: err } = await supabase.from('team_members').select('*').order('created_at')
    if (err) setError(err.message)
    else if (data) setMembers(data)
    setLoading(false)
  }

  async function addMember() {
    if (!name.trim() || !email.trim() || !password) return
    setSaving(true)
    setError(null)

    const res = await fetch('/api/team/create-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), email: email.trim(), password, role, color,
        hourly_rate_usd: parseFloat(rate) || 0,
      }),
    })
    const json = await res.json()

    setSaving(false)
    if (!res.ok) { setError(json.error); return }

    setName(''); setEmail(''); setPassword(''); setRole('designer'); setRate(''); setColor(COLOR_PALETTE[0])
    setShowForm(false)
    fetchMembers()
  }

  async function deleteMember(id: string) {
    await fetch('/api/team/delete-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  function startRateEdit(m: TeamMember) {
    setEditingRateId(m.id)
    setEditRateValue(String(m.hourly_rate_usd ?? 0))
  }

  async function saveRate(id: string) {
    const value = parseFloat(editRateValue) || 0
    setEditingRateId(null)
    setMembers(prev => prev.map(m => m.id === id ? { ...m, hourly_rate_usd: value } : m))
    await supabase.from('team_members').update({ hourly_rate_usd: value }).eq('id', id)
  }

  const loginUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/team/login`
    : '/team/login'

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Команда</h1>
          <p className="text-sm text-gray-500 mt-0.5">Дизайнери та учасники команди</p>
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
              <label className="text-xs text-gray-500 mb-1 block">Імʼя *</label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Імʼя Прізвище"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email *</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Пароль *</label>
              <div className="relative">
                <input
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Мінімум 6 символів"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Рейт $/год</label>
              <input
                type="number" step="0.5" min="0"
                value={rate}
                onChange={e => setRate(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>

          <div className="mb-4">
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

          <div className="flex gap-2">
            <button
              onClick={addMember}
              disabled={saving || !name.trim() || !email.trim() || !password}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-700 transition-colors"
            >
              {saving ? 'Збереження...' : 'Додати'}
            </button>
            <button
              onClick={() => { setShowForm(false); setName(''); setEmail(''); setPassword('') }}
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
                  <p className="text-xs text-gray-400">{m.email ?? m.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 px-2 py-1 border border-gray-100 rounded-lg">
                  {m.role}
                </span>
                {editingRateId === m.id ? (
                  <input
                    autoFocus
                    type="number" step="0.5" min="0"
                    value={editRateValue}
                    onChange={e => setEditRateValue(e.target.value)}
                    onBlur={() => saveRate(m.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRate(m.id); if (e.key === 'Escape') setEditingRateId(null) }}
                    className="w-20 border border-teal-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                ) : (
                  <button
                    onClick={() => startRateEdit(m)}
                    title="Змінити рейт"
                    className="text-xs text-teal-600 bg-teal-50 hover:bg-teal-100 px-2 py-1 rounded-lg transition-colors"
                  >
                    ${m.hourly_rate_usd ?? 0}/год
                  </button>
                )}
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

      {/* Login info box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl">
        <p className="text-sm font-medium text-blue-800 mb-1">Як увійти в систему</p>
        <p className="text-xs text-blue-600 mb-2">
          Надішліть учаснику цей лінк та пароль, який ви встановили під час створення акаунту.
        </p>
        <code className="text-xs bg-white border border-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg block break-all">
          {loginUrl}
        </code>
      </div>
    </div>
  )
}
