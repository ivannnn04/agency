'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Eye, RefreshCw } from 'lucide-react'

// The client's own workspace for this project, embedded in the admin board:
// exactly what the client sees after signing in, opened through a
// short-lived read-only preview link.

interface PreviewClient { id: string; email: string; name: string | null }

export default function ClientPreview({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState('')
  const [clients, setClients] = useState<PreviewClient[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/projects/portal-preview?project=${projectId}${clientId ? `&client=${clientId}` : ''}`)
      .then(async res => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        if (!alive) return
        setUrl(d.url)
        setClients(d.clients ?? [])
        setError('')
      })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [projectId, clientId, nonce])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Eye size={13} /> Очима клієнта</span>
        {clients.length > 1 ? (
          <select
            value={clientId ?? clients[0].id}
            onChange={e => setClientId(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none"
          >
            {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
          </select>
        ) : (
          <span className="text-xs text-gray-400">
            {clients.length === 1 ? clients[0].name || clients[0].email : 'до проєкту ще не додано клієнта — показую, що побачить будь-який клієнт'}
          </span>
        )}
        <span className="text-xs text-gray-400">лише перегляд: звідси нічого не надсилається від імені клієнта</span>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => setNonce(n => n + 1)} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900">
            <RefreshCw size={11} /> Оновити
          </button>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900">
              <ExternalLink size={11} /> У новій вкладці
            </a>
          )}
        </div>
      </div>
      {error ? (
        <p className="text-sm text-red-500 p-6">{error}</p>
      ) : url ? (
        <iframe key={url} src={url} title="Вигляд клієнта" className="flex-1 w-full border-0 bg-gray-50" />
      ) : (
        <p className="text-sm text-gray-400 p-6">Відкриваю кабінет клієнта…</p>
      )}
    </div>
  )
}
