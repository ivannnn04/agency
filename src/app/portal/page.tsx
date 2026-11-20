'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ArrowUpRight, FolderKanban, LogOut, Mail } from 'lucide-react'
import { PortalHeader, PortalPreviewBanner } from '@/components/portal/PortalChrome'
import { PORTAL_TEXT, PortalLang, portalLang } from '@/lib/portalI18n'

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
const LANG_KEY = 'gudrix:portalLang'

export default function PortalDashboardPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clientName, setClientName] = useState<string | null>(null)
  const [notLinked, setNotLinked] = useState(false)
  const [projects, setProjects] = useState<PortalProject[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [lang, setLang] = useState<PortalLang>('en')
  const t = PORTAL_TEXT[lang]

  useEffect(() => {
    ;(async () => {
      // Until the server answers, speak the language of the last visit
      try { setLang(portalLang(localStorage.getItem(LANG_KEY))) } catch { /* storage unavailable */ }

      // The admin's preview link carries its own read-only token
      const previewToken = new URLSearchParams(window.location.search).get('preview')
      let accessToken = previewToken
      if (!accessToken) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { router.replace('/portal/login'); return }
        accessToken = session.access_token
      }
      setPreview(previewToken)

      const res = await fetch('/api/portal/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.status === 401) { router.replace('/portal/login'); return }
      const data = await res.json()
      if (res.status === 403 && !previewToken) {
        // Signed in, but this email is not on the client list
        await supabase.auth.signOut()
        router.replace(`/portal/login?denied=${encodeURIComponent(data.email ?? '')}`)
        return
      }
      setEmail(data.email ?? '')
      setLang(portalLang(data.lang))
      if (!previewToken) { try { localStorage.setItem(LANG_KEY, portalLang(data.lang)) } catch { /* storage unavailable */ } }
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

  const firstName = (clientName ?? '').trim().split(/\s+/)[0] ?? ''

  return (
    <div className="min-h-screen bg-white">
      {preview && <PortalPreviewBanner text="Режим перегляду — так свій кабінет бачить клієнт." />}
      <PortalHeader
        label={t.workspace}
        right={
          <>
            <span className="hidden sm:block text-[13px] text-white/60 mx-2 truncate max-w-[220px]">{clientName || email}</span>
            {!preview && (
              <button onClick={logout} className="text-white/50 hover:text-white transition-colors p-1.5" title={t.signOut}>
                <LogOut size={16} />
              </button>
            )}
          </>
        }
      />

      <main className="px-5 sm:px-8 lg:px-12 py-10 lg:py-14">
        {loading ? (
          <p className="text-gray-400 text-sm py-16">{t.loading}</p>
        ) : notLinked ? (
          <div className="py-20 max-w-xl">
            <Mail size={32} className="mb-4 text-gray-300" />
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{t.notLinkedTitle}</h1>
            <p className="text-gray-500 mt-3 leading-relaxed">{t.notLinkedBody(email)}</p>
          </div>
        ) : (
          <>
            <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{t.welcome(firstName)}</h1>
            <p className="text-gray-500 mt-2">{t.homeSub}</p>

            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400 mt-12 mb-4">{t.yourProjects}</p>
            {projects.length === 0 ? (
              <div className="py-16 border border-gray-100 rounded-3xl text-center text-gray-400">
                <FolderKanban size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">{t.noProjects}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {projects.map(p => {
                  const sym = CURRENCY_SYMBOL[p.contract_currency ?? 'USD']
                  return (
                    <Link
                      key={p.id}
                      href={`/portal/project/${p.id}${preview ? `?preview=${encodeURIComponent(preview)}` : ''}`}
                      className="group relative border border-gray-100 rounded-3xl p-7 hover:border-gray-900 transition-colors flex flex-col min-h-[220px]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <span className="w-3 h-3 rounded-full mt-2" style={{ backgroundColor: p.color ?? '#2affaa' }} />
                        <span className="w-10 h-10 rounded-full border border-gray-200 group-hover:bg-gray-900 group-hover:border-gray-900 group-hover:text-white text-gray-400 flex items-center justify-center transition-colors">
                          <ArrowUpRight size={17} />
                        </span>
                      </div>
                      <p className="text-2xl font-semibold text-gray-900 tracking-tight mt-auto pt-10 leading-tight">{p.name}</p>
                      <div className="flex items-center gap-x-6 gap-y-1 flex-wrap mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
                        <span>{t.tasks(p.task_count)}</span>
                        {(p.contract_amount ?? 0) > 0 && (
                          <span>{t.budget}: <span className="text-gray-900 font-medium">{sym}{p.contract_amount!.toLocaleString('en-US')}</span></span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
