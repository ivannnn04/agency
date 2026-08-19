'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Eye, EyeOff } from 'lucide-react'

// Landing page for team invitation links. The Supabase recovery link drops the
// member here with a session in the URL hash — they set a password and go to
// their dashboard.
export default function TeamWelcomePage() {
  const router = useRouter()
  const [ready, setReady]       = useState(false)
  const [noSession, setNoSession] = useState(false)
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    // supabase-js parses the tokens from the URL hash itself; give it a moment
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < 10; i++) {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (session) {
          const { data: mem } = await supabase
            .from('team_members').select('name').eq('supabase_user_id', session.user.id).single()
          if (!cancelled) { setName(mem?.name ?? ''); setReady(true) }
          return
        }
        await new Promise(r => setTimeout(r, 300))
      }
      if (!cancelled) setNoSession(true)
    })()
    return () => { cancelled = true }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Пароль має бути мінімум 6 символів'); return }
    if (password !== confirm) { setError('Паролі не збігаються'); return }
    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (err) { setError(err.message); return }
    router.replace('/team/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-sm p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">G</span>
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-900">Gudrix</p>
            <p className="text-xs text-gray-400">Cowork Space</p>
          </div>
        </div>

        {noSession ? (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Лінк недійсний</h1>
            <p className="text-sm text-gray-400 mb-6">
              Запрошення застаріло або вже використане. Попроси адміністратора надіслати нове,
              або увійди, якщо пароль уже встановлено.
            </p>
            <Link
              href="/team/login"
              className="block text-center bg-teal-500 hover:bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              До сторінки входу
            </Link>
          </div>
        ) : !ready ? (
          <p className="text-sm text-gray-400 text-center py-8">Перевіряємо запрошення...</p>
        ) : (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">
              Вітаємо{name ? `, ${name.split(' ')[0]}` : ''}! 👋
            </h1>
            <p className="text-sm text-gray-400 mb-6">
              Залишилось встановити пароль для входу в робочий простір
            </p>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Пароль</label>
                <div className="relative">
                  <input
                    autoFocus
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Мінімум 6 символів"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    required
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Пароль ще раз</label>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                {saving ? 'Зберігаємо...' : 'Встановити пароль і увійти'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
