'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

// PWA launcher: the installed app opens here. Anyone already signed in
// goes straight to their home; everyone else picks who they are.
export default function StartPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        // Team member (or client) — Supabase session
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user?.email) {
          const { data: member } = await supabase
            .from('team_members')
            .select('id')
            .ilike('email', session.user.email)
            .maybeSingle()
          if (member) { router.replace('/team/dashboard'); return }
        }
        // Admin — NextAuth session
        const res = await fetch('/api/auth/session')
        const s = res.ok ? await res.json() : null
        if (s?.user) { router.replace('/'); return }
      } catch { /* show the chooser */ }
      setChecking(false)
    })()
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen bg-[#00140c] flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-[#2affaa]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#00140c] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <p className="text-white font-extrabold text-5xl tracking-tight lowercase mb-2">
          gudrix<span className="text-[#2affaa]">.</span>
        </p>
        <p className="text-white/50 text-sm mb-12">Cowork Space</p>

        <button
          onClick={() => router.push('/login')}
          className="w-full bg-white hover:bg-[#2affaa] text-[#00140c] font-semibold text-base rounded-2xl py-4 transition-colors mb-3"
        >
          Я адмін
        </button>
        <button
          onClick={() => router.push('/team/login')}
          className="w-full border border-white/30 hover:border-[#2affaa] hover:text-[#2affaa] text-white font-semibold text-base rounded-2xl py-4 transition-colors"
        >
          Я в команді
        </button>

        <a href="/portal" className="text-white/40 hover:text-[#2affaa] text-xs mt-10 transition-colors">
          Я клієнт — портал проєктів →
        </a>
      </div>
    </div>
  )
}
