'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Camera, Check, Loader2 } from 'lucide-react'

// Team member profile: photo, name, nickname, custom status (emoji + text)
// and password change. Everything saves into team_members / Supabase Auth.

interface ProfileMember {
  id: string
  name: string
  color: string
  role: string
  avatar_url?: string | null
  nickname?: string | null
  status_emoji?: string | null
  status_text?: string | null
}

const STATUS_EMOJIS = ['💬', '🎨', '💻', '🔥', '☕', '🏖', '🤒', '🎧', '🍕', '🚀', '🌙', '📵']

export default function TeamProfilePage() {
  const router = useRouter()
  const [member, setMember] = useState<ProfileMember | null>(null)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [statusEmoji, setStatusEmoji] = useState('')
  const [statusText, setStatusText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/team/login'); return }
      const { data: mem } = await supabase
        .from('team_members').select('*').eq('supabase_user_id', user.id).single()
      if (!mem) { router.replace('/team/login'); return }
      const m = mem as ProfileMember
      setMember(m)
      setName(m.name)
      setNickname(m.nickname ?? '')
      setStatusEmoji(m.status_emoji ?? '')
      setStatusText(m.status_text ?? '')
    })()
  }, [router])

  async function uploadAvatar(f: File) {
    if (!member) return
    setUploading(true)
    setError('')
    const path = `avatars/${member.id}-${Date.now()}.${f.name.split('.').pop() ?? 'jpg'}`
    const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f, { upsert: true })
    if (upErr) { setUploading(false); setError('Не вдалося завантажити фото'); return }
    const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
    const { error: dbErr } = await supabase
      .from('team_members').update({ avatar_url: pub.publicUrl }).eq('id', member.id)
    if (dbErr) setError('Запусти міграцію team_profile_migration.sql')
    else setMember({ ...member, avatar_url: pub.publicUrl })
    setUploading(false)
  }

  async function saveProfile() {
    if (!member || saving) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('team_members')
      .update({
        name: name.trim() || member.name,
        nickname: nickname.trim() || null,
        status_emoji: statusEmoji || null,
        status_text: statusText.trim() || null,
      })
      .eq('id', member.id)
    setSaving(false)
    if (err) { setError('Запусти міграцію team_profile_migration.sql'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function changePassword() {
    setPwMsg('')
    if (pw1.length < 8) { setPwMsg('Пароль має бути мінімум 8 символів'); return }
    if (pw1 !== pw2) { setPwMsg('Паролі не збігаються'); return }
    setPwSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    setPwSaving(false)
    if (err) { setPwMsg('Не вдалося змінити пароль: ' + err.message); return }
    setPw1(''); setPw2('')
    setPwMsg('Пароль змінено ✅')
  }

  if (!member) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Завантаження...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0f1117] text-white px-6 py-4 flex items-center gap-3">
        <button onClick={() => router.push('/team/dashboard')} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 text-sm">
          <ArrowLeft size={16} /> Назад
        </button>
        <p className="font-semibold text-sm ml-2">Мій профіль</p>
      </header>

      <main className="max-w-xl mx-auto p-6 flex flex-col gap-6">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3">{error}</div>
        )}

        {/* Photo + basics */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              {member.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={member.avatar_url} alt={member.name} className="w-20 h-20 rounded-full object-cover" />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{ backgroundColor: member.color || '#14b8a6' }}
                >
                  {member.name.charAt(0)}
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
              <p className="text-lg font-bold text-gray-900 truncate">{nickname || name}</p>
              <p className="text-xs text-gray-400">{member.role}</p>
              {(statusEmoji || statusText) && (
                <p className="text-xs text-gray-500 mt-1 truncate">{statusEmoji} {statusText}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs text-gray-500 font-medium">
              Ім&apos;я
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500 font-medium">
              Нік (показується замість імені)
              <input
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="необовʼязково"
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
                placeholder="Що в тебе зараз? (наприклад: у відпустці до 15-го)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={saving}
              className="self-start flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {saved ? <><Check size={14} /> Збережено</> : saving ? 'Зберігаємо...' : 'Зберегти профіль'}
            </button>
          </div>
        </div>

        {/* Password */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3">
          <p className="text-sm font-bold text-gray-900">Зміна пароля</p>
          <input
            type="password"
            value={pw1}
            onChange={e => setPw1(e.target.value)}
            placeholder="Новий пароль (мін. 8 символів)"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
          />
          <input
            type="password"
            value={pw2}
            onChange={e => setPw2(e.target.value)}
            placeholder="Повтори пароль"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
          />
          {pwMsg && (
            <p className={`text-xs ${pwMsg.includes('✅') ? 'text-teal-600' : 'text-red-500'}`}>{pwMsg}</p>
          )}
          <button
            onClick={changePassword}
            disabled={pwSaving || !pw1}
            className="self-start bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {pwSaving ? 'Змінюємо...' : 'Змінити пароль'}
          </button>
        </div>
      </main>
    </div>
  )
}
