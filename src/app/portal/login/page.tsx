'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  // ?denied=<email> — a signed-in account was turned away: not a client
  const [dismissed, setDismissed] = useState(false)
  const denied = dismissed ? null : searchParams.get('denied')
  const [loading, setLoading]   = useState(false)
  // Shown only when the Google provider is switched on in Supabase Auth —
  // otherwise the button leads to a raw "provider is not enabled" error
  const [googleOn, setGoogleOn] = useState(false)

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setGoogleOn(d?.external?.google === true))
      .catch(() => {})
  }, [])

  // Already signed in → straight to the dashboard
  useEffect(() => {
    if (searchParams.get('denied') !== null) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/portal')
    })
  }, [router, searchParams])

  // Access is by invitation only — there is no self-registration here.
  // An invited client sets a password from the link in the invitation email.
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setDismissed(true)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError('Invalid email or password. First time here? Use the link in your invitation email to set a password.'); return }
    router.push('/portal')
  }

  async function googleAuth() {
    setError('')
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portal` },
    })
  }

  return (
    <div className="on-dark min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="bg-[#18181b] border border-white/[0.06] rounded-2xl p-10 w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-xl font-bold text-[#09090b]">G</span>
          </div>
          <h1 className="text-xl font-bold text-white">Gudrix — Client Portal</h1>
          <p className="text-gray-400 mt-1 text-sm">Track your projects and talk to the team</p>
        </div>

        {denied !== null && (
          <div className="border border-red-500/30 bg-red-500/10 rounded-xl px-4 py-3 mb-5">
            <p className="text-sm font-medium text-red-300">No access for this account</p>
            <p className="text-xs text-red-200/80 mt-1 leading-relaxed">
              {denied ? <><span className="font-medium">{denied}</span> is not registered as a Gudrix client.</> : 'This account is not registered as a Gudrix client.'}
              {' '}Sign in with the email your invitation was sent to, or ask your Gudrix contact to add this one.
            </p>
          </div>
        )}

        {/* Google */}
        {googleOn && <>
        <button
          onClick={googleAuth}
          className="w-full flex items-center justify-center gap-3 bg-[#27272a] border border-white/10 text-white font-medium py-3 px-6 rounded-xl hover:bg-[#3f3f46] transition-colors mb-4"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-gray-500">or with email</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>
        </>}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full bg-[#09090b] border border-white/10 !text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-white/40 placeholder-gray-600"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#09090b] border border-white/10 !text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-white/40 placeholder-gray-600"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-white hover:bg-[#e4e4e7] disabled:opacity-50 text-[#09090b] font-medium py-3 rounded-xl text-sm transition-colors mt-1"
          >
            {loading ? 'Please wait...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-5 leading-relaxed">
          Access is by invitation. New here? Open the link in your invitation email.
        </p>

        <p className="text-center text-xs text-gray-500 mt-4">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
          <span className="mx-2">·</span>
          <a href="/terms" className="hover:text-white transition-colors">Terms of Service</a>
        </p>
      </div>
    </div>
  )
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b]" />}>
      <LoginForm />
    </Suspense>
  )
}
