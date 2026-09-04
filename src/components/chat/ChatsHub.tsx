'use client'

import { useState, useEffect } from 'react'
import { Hash, MessageSquare, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ProjectChat, { ChatSender } from '@/components/ProjectChat'
import GeneralChat, { GeneralChatInfo } from '@/components/GeneralChat'
import DMChat, { DMPeer, dmKeyFor } from '@/components/DMChat'
import { ChannelUnread } from '@/lib/chatUnread'
import { getAdminProfile } from '@/lib/adminProfile'
import MembersPanel from '@/components/chat/MembersPanel'
import { useOnlineUsers } from '@/lib/presence'

// Discord-style chat hub: channel list on the left, the open chat on the
// right. Used on the team dashboard («Чати» tab) and the admin /chats page.
// On mobile the channel list takes the full width and chats open as the
// usual full-screen drawers.

export interface HubProject {
  id: string
  name: string
  color: string
}

export default function ChatsHub({ projects, generalChats, sender, unread, onCreateGeneral, onGeneralDeleted, heightOffset = 210 }: {
  projects: HubProject[]
  generalChats: GeneralChatInfo[]
  sender: ChatSender
  unread: Record<string, ChannelUnread>
  onCreateGeneral?: () => void
  onGeneralDeleted?: (id: string) => void
  heightOffset?: number
}) {
  const [selected, setSelected] = useState<{ kind: 'project' | 'general' | 'dm'; id: string } | null>(null)
  const [drawerProject, setDrawerProject] = useState<HubProject | null>(null)
  const [drawerGeneral, setDrawerGeneral] = useState<GeneralChatInfo | null>(null)
  const [drawerDM, setDrawerDM] = useState<DMPeer | null>(null)
  const [people, setPeople] = useState<DMPeer[]>([])

  const selfKey = sender.type === 'admin' ? 'admin' : `team-${sender.teamMemberId}`
  const online = useOnlineUsers()

  // Everyone internal except me — for direct messages (profile columns may
  // not be migrated yet, so fall back to the base select)
  useEffect(() => {
    ;(async () => {
      let { data } = await supabase
        .from('team_members')
        .select('id, name, color, nickname, avatar_url, status_emoji, status_text')
        .order('name')
      if (!data) {
        ;({ data } = await supabase.from('team_members').select('id, name, color').order('name') as never)
      }
      const rows = (data ?? []) as { id: string; name: string; color: string; nickname?: string | null; avatar_url?: string | null; status_emoji?: string | null; status_text?: string | null }[]
      const admin = await getAdminProfile()
      const list: DMPeer[] = [
        {
          key: 'admin',
          name: `${admin.name} (адмін)`,
          color: '#0ea5e9',
          avatar_url: admin.avatar_url,
          status_emoji: admin.status_emoji,
          status_text: admin.status_text,
        },
        ...rows.map(m => ({
          key: `team-${m.id}`,
          name: m.nickname || m.name,
          color: m.color || '#14b8a6',
          avatar_url: m.avatar_url,
          status_emoji: m.status_emoji,
          status_text: m.status_text,
        })),
      ]
      setPeople(list.filter(p => p.key !== selfKey))
    })()
  }, [selfKey])

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

  function openProject(p: HubProject) {
    if (isMobile()) setDrawerProject(p)
    else setSelected({ kind: 'project', id: p.id })
  }

  function openGeneral(c: GeneralChatInfo) {
    if (isMobile()) setDrawerGeneral(c)
    else setSelected({ kind: 'general', id: c.id })
  }

  function openDM(p: DMPeer) {
    if (isMobile()) setDrawerDM(p)
    else setSelected({ kind: 'dm', id: p.key })
  }

  const selProject = selected?.kind === 'project' ? projects.find(p => p.id === selected.id) : undefined
  const selGeneral = selected?.kind === 'general' ? generalChats.find(c => c.id === selected.id) : undefined
  const selDM = selected?.kind === 'dm' ? people.find(p => p.key === selected.id) : undefined

  return (
    <>
      <div
        className="flex bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm"
        style={{ height: `calc(100vh - ${heightOffset}px)`, minHeight: 420 }}
      >
        {/* Channel list */}
        <div className="w-full md:w-64 md:max-w-[45vw] flex-shrink-0 md:border-r border-gray-100 bg-gray-50 overflow-y-auto py-3">
          <p className="px-4 text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Проєкти</p>
          {projects.length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-400">Немає проєктів</p>
          )}
          {projects.map(p => {
            const active = selected?.kind === 'project' && selected.id === p.id
            const u = unread[p.id]
            const count = (u?.teamCount ?? 0) + (u?.clientCount ?? 0)
            return (
              <button
                key={p.id}
                onClick={() => openProject(p)}
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left transition-colors ${
                  active ? 'bg-gray-200/70 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } ${count > 0 ? 'font-semibold text-gray-900' : ''}`}
              >
                <Hash size={13} className="flex-shrink-0" style={{ color: p.color }} />
                <span className="truncate min-w-0">{p.name}</span>
                {count > 0 && (
                  <span
                    className={`ml-auto flex-shrink-0 text-[10px] font-bold text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
                      u?.clientNew ? 'bg-amber-500' : 'bg-teal-500'
                    }`}
                    title={u?.clientNew ? 'Клієнт написав' : 'Нові повідомлення'}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}

          <div className="flex items-center justify-between px-4 mt-4 mb-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Загальні</p>
            {onCreateGeneral && (
              <button
                onClick={onCreateGeneral}
                className="text-gray-400 hover:text-gray-600 p-0.5 rounded transition-colors"
                title="Новий чат"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          {generalChats.length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-400">Немає загальних чатів</p>
          )}
          {generalChats.map(c => {
            const active = selected?.kind === 'general' && selected.id === c.id
            const count = unread[`chat:${c.id}`]?.teamCount ?? 0
            return (
              <button
                key={c.id}
                onClick={() => openGeneral(c)}
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left transition-colors ${
                  active ? 'bg-gray-200/70 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } ${count > 0 ? 'font-semibold text-gray-900' : ''}`}
              >
                <Hash size={13} className="text-teal-500 flex-shrink-0" />
                <span className="truncate min-w-0">{c.name}</span>
                {count > 0 && (
                  <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-white bg-teal-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}

          {/* Direct messages */}
          <p className="px-4 mt-4 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Особисті</p>
          {people.map(p => {
            const active = selected?.kind === 'dm' && selected.id === p.key
            const count = unread[`dm:${dmKeyFor(selfKey, p.key)}`]?.teamCount ?? 0
            return (
              <button
                key={p.key}
                onClick={() => openDM(p)}
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left transition-colors ${
                  active ? 'bg-gray-200/70 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } ${count > 0 ? 'font-semibold text-gray-900' : ''}`}
              >
                <span className="relative flex-shrink-0">
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar_url} alt={p.name} className="w-5 h-5 rounded-full object-cover block" />
                  ) : (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.charAt(0)}
                    </span>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-gray-50 ${
                      online[p.key] ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                    title={online[p.key] ? 'онлайн' : 'офлайн'}
                  />
                </span>
                <span className="truncate min-w-0">{p.name}</span>
                {(p.status_emoji || p.status_text) && (
                  <span className="text-[10px] text-gray-400 truncate flex-shrink" title={p.status_text ?? ''}>
                    {p.status_emoji} {p.status_text}
                  </span>
                )}
                {count > 0 && (
                  <span className="ml-auto flex-shrink-0 text-[10px] font-bold text-white bg-teal-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Open chat (desktop pane) */}
        <div className="flex-1 min-w-0 hidden md:flex flex-col">
          {selProject ? (
            <ProjectChat
              key={selProject.id}
              projectId={selProject.id}
              projectName={selProject.name}
              sender={sender}
              embedded
              onClose={() => setSelected(null)}
            />
          ) : selGeneral ? (
            <GeneralChat
              key={selGeneral.id}
              chat={selGeneral}
              sender={sender}
              embedded
              onClose={() => setSelected(null)}
              onDeleted={() => { onGeneralDeleted?.(selGeneral.id); setSelected(null) }}
            />
          ) : selDM ? (
            <DMChat
              key={selDM.key}
              peer={selDM}
              sender={sender}
              embedded
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-300">
              <MessageSquare size={28} className="opacity-40" />
              <p className="text-sm">Обери чат зліва</p>
            </div>
          )}
        </div>

        {/* Discord-style members column: who's here, online / offline */}
        <MembersPanel selection={selected ? { ...selected, dmPeerKey: selfKey } : null} />
      </div>

      {/* Mobile: full-screen drawers */}
      {drawerProject && (
        <ProjectChat
          projectId={drawerProject.id}
          projectName={drawerProject.name}
          sender={sender}
          onClose={() => setDrawerProject(null)}
        />
      )}
      {drawerGeneral && (
        <GeneralChat
          chat={drawerGeneral}
          sender={sender}
          onClose={() => setDrawerGeneral(null)}
          onDeleted={() => { onGeneralDeleted?.(drawerGeneral.id); setDrawerGeneral(null) }}
        />
      )}
      {drawerDM && (
        <DMChat
          peer={drawerDM}
          sender={sender}
          onClose={() => setDrawerDM(null)}
        />
      )}
    </>
  )
}
