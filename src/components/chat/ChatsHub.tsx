'use client'

import { useState } from 'react'
import { Hash, MessageSquare, Plus } from 'lucide-react'
import ProjectChat, { ChatSender } from '@/components/ProjectChat'
import GeneralChat, { GeneralChatInfo } from '@/components/GeneralChat'
import { ChannelUnread } from '@/lib/chatUnread'

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
  const [selected, setSelected] = useState<{ kind: 'project' | 'general'; id: string } | null>(null)
  const [drawerProject, setDrawerProject] = useState<HubProject | null>(null)
  const [drawerGeneral, setDrawerGeneral] = useState<GeneralChatInfo | null>(null)

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

  function openProject(p: HubProject) {
    if (isMobile()) setDrawerProject(p)
    else setSelected({ kind: 'project', id: p.id })
  }

  function openGeneral(c: GeneralChatInfo) {
    if (isMobile()) setDrawerGeneral(c)
    else setSelected({ kind: 'general', id: c.id })
  }

  const selProject = selected?.kind === 'project' ? projects.find(p => p.id === selected.id) : undefined
  const selGeneral = selected?.kind === 'general' ? generalChats.find(c => c.id === selected.id) : undefined

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
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-300">
              <MessageSquare size={28} className="opacity-40" />
              <p className="text-sm">Обери чат зліва</p>
            </div>
          )}
        </div>
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
    </>
  )
}
