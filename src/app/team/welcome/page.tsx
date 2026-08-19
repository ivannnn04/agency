'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Eye, EyeOff } from 'lucide-react'

// Landing page for team invitation links (/team/welcome?token=...).
// The token is our own single-use invite token — it's only consumed when the
// form is submitted, so email link scanners can't burn it. After setting the
// password we sign the member in and send them to their dashboard.

function WelcomeInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')

  const [checking, setChecking] = useState(true)
  const [invalid, setInvalid]   = useState('')
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (!token) { setInvalid('This link has no invitation token.'); setChecking(false); return }
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/team/accept-invite?token=${encodeURIComponent(token)}`)
      const json = await res.json()
      if (cancelled) return
      if (!res.ok) setInvalid(json.error ?? 'Invalid link')
      else setName(json.name ?? '')
      setChecking(false)
    })()
    return () => { cancelled = true }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords don\u2019t match'); return }
    setSaving(true)

    const res = await fetch('/api/team/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const json = await res.json()
    if (!res.ok) { setSaving(false); setError(json.error ?? 'Something went wrong'); return }

    // Password is set — sign in right away and go to the dashboard
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: json.email,
      password,
    })
    setSaving(false)
    if (signErr) { router.replace('/team/login'); return }
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

        {checking ? (
          <p className="text-sm text-gray-400 text-center py-8">Checking your invitation...</p>
        ) : invalid ? (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Invalid link</h1>
            <p className="text-sm text-gray-400 mb-6">{invalid}</p>
            <Link
              href="/team/login"
              className="block text-center bg-teal-500 hover:bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">
              Welcome{name ? `, ${name.split(' ')[0]}` : ''}! 👋
            </h1>
            <p className="text-sm text-gray-400 mb-6">
              Just set a password to access your workspace
            </p>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <div className="relative">
                  <input
                    autoFocus
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Repeat password</label>
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
                {saving ? 'Saving...' : 'Set password and sign in'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeamWelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <WelcomeInner />
    </Suspense>
  )
}
