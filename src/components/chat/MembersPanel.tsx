'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useOnlineUsers } from '@/lib/presence'
import { getAdminProfile } from '@/lib/adminProfile'

// Discord-style members column for the chat hub: who belongs to the open
// chat, grouped into Онлайн / Офлайн by live presence.

export interface PanelPerson {
  key: string
  name: string
  color: string
  avatar_url?: string | null
  status_emoji?: string | null
  status_text?: string | null
}

export default function MembersPanel({ selection }: {
  selection: { kind: 'project' | 'general' | 'dm'; id: string; dmPeerKey?: string } | null
}) {
  const [people, setPeople] = useState<PanelPerson[]>([])
  const online = useOnlineUsers()

  useEffect(() => {
    if (!selection) { setPeople([]); return }
    ;(async () => {
      const admin = await getAdminProfile()
      const adminEntry: PanelPerson = {
        key: 'admin',
        name: `${admin.name} (адмін)`,
        color: '#0ea5e9',
        avatar_url: admin.avatar_url,
        status_emoji: admin.status_emoji,
        status_text: admin.status_text,
      }
      const { data: mems } = await supabase
        .from('team_members')
        .select('id, name, color, nickname, avatar_url, status_emoji, status_text')
        .order('name')
      const all = ((mems ?? []) as {
        id: string; name: string; color: string
        nickname?: string | null; avatar_url?: string | null
        status_emoji?: string | null; status_text?: string | null
      }[]).map(m => ({
        key: `team-${m.id}`,
        name: m.nickname || m.name,
        color: m.color || '#14b8a6',
        avatar_url: m.avatar_url,
        status_emoji: m.status_emoji,
        status_text: m.status_text,
      }))

      if (selection.kind === 'project') {
        const { data: pm } = await supabase
          .from('project_members')
          .select('team_member_id')
          .eq('project_id', selection.id)
        const ids = new Set((pm ?? []).map((r: { team_member_id: string }) => `team-${r.team_member_id}`))
        setPeople([adminEntry, ...all.filter(p => ids.has(p.key))])
      } else if (selection.kind === 'general') {
        const { data: gm } = await supabase
          .from('general_chat_members')
          .select('team_member_id')
          .eq('chat_id', selection.id)
        const ids = new Set((gm ?? []).map((r: { team_member_id: string }) => `team-${r.team_member_id}`))
        // no explicit members = the whole team sees the chat
        setPeople([adminEntry, ...(ids.size > 0 ? all.filter(p => ids.has(p.key)) : all)])
      } else {
        const peer = selection.dmPeerKey
        setPeople([adminEntry, ...all].filter(p => p.key === peer || p.key === selection.id))
      }
    })()
  }, [selection?.kind, selection?.id, selection?.dmPeerKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selection || people.length === 0) return null

  const isOn = (p: PanelPerson) => !!online[p.key]
  const onlineList = people.filter(isOn)
  const offlineList = people.filter(p => !isOn(p))

  const Row = ({ p, off }: { p: PanelPerson; off?: boolean }) => (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${off ? 'opacity-50' : ''}`}>
      <div className="relative flex-shrink-0">
        {p.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.avatar_url} alt={p.name} className="w-7 h-7 rounded-full object-cover" />
        ) : (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold"
            style={{ backgroundColor: p.color }}
          >
            {p.name.charAt(0)}
          </span>
        )}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-gray-50 ${
            off ? 'bg-gray-300' : 'bg-green-500'
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700 truncate">{p.name}</p>
        {(p.status_emoji || p.status_text) && (
          <p className="text-[10px] text-gray-400 truncate">{p.status_emoji} {p.status_text}</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="hidden lg:block w-56 flex-shrink-0 border-l border-gray-100 bg-gray-50 overflow-y-auto py-3">
      {onlineList.length > 0 && (
        <>
          <p className="px-4 text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
            Онлайн — {onlineList.length}
          </p>
          {onlineList.map(p => <Row key={p.key} p={p} />)}
        </>
      )}
      {offlineList.length > 0 && (
        <>
          <p className="px-4 text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1 mt-3">
            Офлайн — {offlineList.length}
          </p>
          {offlineList.map(p => <Row key={p.key} p={p} off />)}
        </>
      )}
    </div>
  )
}
