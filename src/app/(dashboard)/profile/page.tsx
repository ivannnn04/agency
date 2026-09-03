'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getAdminProfile, clearAdminProfileCache } from '@/lib/adminProfile'
import { Camera, Check, Loader2 } from 'lucide-react'

const STATUS_EMOJIS = ['💬', '🎨', '💻', '🔥', '☕', '🏖', '🤒', '🎧', '🍕', '🚀', '🌙', '📵']

// Admin profile: photo, display name and status shown across the app
// (chats, calls, mentions). Login itself stays Google — no password here.
export default function AdminProfilePage() {
  const [name, setName] = useState('Ivan')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [statusEmoji, setStatusEmoji] = useState('')
  const [statusText, setStatusText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(async () => {
      const p = await getAdminProfile()
      setName(p.name)
      setAvatarUrl(p.avatar_url)
      setStatusEmoji(p.status_emoji ?? '')
      setStatusText(p.status_text ?? '')
      setLoading(false)
    })()
  }, [])

  async function uploadAvatar(f: File) {
    setUploading(true)
    setError('')
    const path = `avatars/admin-${Date.now()}.${f.name.split('.').pop() ?? 'jpg'}`
    const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f, { upsert: true })
    if (upErr) { setUploading(false); setError('Не вдалося завантажити фото'); return }
    const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
    setAvatarUrl(pub.publicUrl)
    setUploading(false)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('admin_profile').upsert({
      id: 'main',
      name: name.trim() || 'Ivan',
      avatar_url: avatarUrl,
      status_emoji: statusEmoji || null,
      status_text: statusText.trim() || null,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (err) { setError('Запусти міграцію admin_profile_migration.sql'); return }
    clearAdminProfileCache()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <p className="p-6 text-sm text-gray-400">Завантаження...</p>

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Мій профіль</h1>
      <p className="text-xs text-gray-400 mb-6">
        Так тебе бачать у чатах і дзвінках. Вхід — через Google, тож пароль змінюється в акаунті Google.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3 mb-4">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={name} className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-sky-500 flex items-center justify-center text-white text-2xl font-bold">
                {name.charAt(0)}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = '' }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 bg-gray-900 hover:bg-gray-700 text-white p-2 rounded-full transition-colors"
              title="Змінити фото"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400">адмін · Gudrix</p>
            {(statusEmoji || statusText) && (
              <p className="text-xs text-gray-500 mt-1 truncate">{statusEmoji} {statusText}</p>
            )}
          </div>
        </div>

        <label className="text-xs text-gray-500 font-medium">
          Ім&apos;я (показується в чатах і дзвінках)
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
          />
        </label>

        <div>
          <p className="text-xs text-gray-500 font-medium mb-1.5">Статус</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {STATUS_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setStatusEmoji(statusEmoji === e ? '' : e)}
                className={`text-lg p-1.5 rounded-lg transition-colors ${
                  statusEmoji === e ? 'bg-teal-100 ring-1 ring-teal-400' : 'hover:bg-gray-100'
                }`}
              >
                {e}
              </button>
            ))}
            <input
              value={statusEmoji}
              onChange={e => setStatusEmoji(e.target.value.slice(0, 4))}
              placeholder="🙂"
              className="w-14 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              title="Або встав свій емодзі"
            />
          </div>
          <input
            value={statusText}
            onChange={e => setStatusText(e.target.value.slice(0, 60))}
            placeholder="Що в тебе зараз?"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="self-start flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          {saved ? <><Check size={14} /> Збережено</> : saving ? 'Зберігаємо...' : 'Зберегти'}
        </button>
      </div>
    </div>
  )
}
