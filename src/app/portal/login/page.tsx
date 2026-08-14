'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PortalLoginPage() {
  const router = useRouter()
  const [mode, setMode]         = useState<'login' | 'register'>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [loading, setLoading]   = useState(false)

  // Already signed in → straight to the dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/portal')
    })
  }, [router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading(true)

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (err) { setError('Invalid email or password'); return }
      router.push('/portal')
    } else {
      if (password.length < 8) { setLoading(false); setError('Password must be at least 8 characters'); return }
      const { data, error: err } = await supabase.auth.signUp({ email, password })
      setLoading(false)
      if (err) { setError(err.message); return }
      if (data.session) {
        router.push('/portal')
      } else {
        setInfo('We’ve sent you a confirmation email — check your inbox and come back here.')
      }
    }
  }

  async function googleAuth() {
    setError('')
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portal` },
    })
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="bg-[#1a1d27] rounded-2xl p-10 w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-xl font-bold text-white">G</span>
          </div>
          <h1 className="text-xl font-bold text-white">Gudrix — Client Portal</h1>
          <p className="text-gray-400 mt-1 text-sm">Track your projects and talk to the team</p>
        </div>

        {/* Login / Register tabs */}
        <div className="flex bg-[#0f1117] rounded-xl p-1 mb-6">
          {([['login', 'Sign in'], ['register', 'Sign up']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setMode(key); setError(''); setInfo('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === key ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Google */}
        <button
          onClick={googleAuth}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-medium py-3 px-6 rounded-xl hover:bg-gray-100 transition-colors mb-4"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-gray-500">or with email</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full bg-[#0f1117] border border-white/10 !text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-500 placeholder-gray-600"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              className="w-full bg-[#0f1117] border border-white/10 !text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-500 placeholder-gray-600"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          {info && <p className="text-teal-400 text-xs">{info}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-sm transition-colors mt-1"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
