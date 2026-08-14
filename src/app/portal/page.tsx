'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { FolderKanban, LogOut, ChevronRight, Mail } from 'lucide-react'

interface PortalProject {
  id: string
  name: string
  color: string | null
  status: string
  contract_amount: number | null
  contract_currency: string | null
  task_count: number
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export default function PortalDashboardPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clientName, setClientName] = useState<string | null>(null)
  const [notLinked, setNotLinked] = useState(false)
  const [projects, setProjects] = useState<PortalProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/portal/login'); return }

      const res = await fetch('/api/portal/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 401) { router.replace('/portal/login'); return }
      const data = await res.json()
      setEmail(data.email ?? '')
      if (!data.client) {
        setNotLinked(true)
      } else {
        setClientName(data.client.name)
        setProjects(data.projects ?? [])
      }
      setLoading(false)
    })()
  }, [router])

  async function logout() {
    await supabase.auth.signOut()
    router.replace('/portal/login')
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-[#0f1117] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">G</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Gudrix — Client Portal</p>
            <p className="text-gray-400 text-xs">{clientName || email}</p>
          </div>
        </div>
        <button onClick={logout} className="text-gray-400 hover:text-white transition-colors" title="Sign out">
          <LogOut size={16} />
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {loading ? (
          <p className="text-center text-gray-400 text-sm py-16">Loading...</p>
        ) : notLinked ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <Mail size={36} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-700 font-medium">Your account is ready — no projects yet</p>
            <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
              Your email <span className="font-medium text-gray-600">{email}</span> isn’t linked to any
              project yet. Contact your Gudrix manager and they’ll add you by this email.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-bold text-gray-900 mb-5">Your projects</h1>
            {projects.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 text-gray-400">
                <FolderKanban size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No projects yet</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {projects.map(p => {
                  const sym = CURRENCY_SYMBOL[p.contract_currency ?? 'USD']
                  return (
                    <Link
                      key={p.id}
                      href={`/portal/project/${p.id}`}
                      className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-sm transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color ?? '#14b8a6' }} />
                        <div>
                          <p className="font-semibold text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {p.task_count} tasks
                            {(p.contract_amount ?? 0) > 0 && (
                              <> · Budget: {sym}{p.contract_amount!.toLocaleString('en-US')}</>
                            )}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-teal-500 group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
