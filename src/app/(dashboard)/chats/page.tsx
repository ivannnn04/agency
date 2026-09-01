'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useChatUnread } from '@/lib/chatUnread'
import ChatsHub, { HubProject } from '@/components/chat/ChatsHub'
import { GeneralChatInfo } from '@/components/GeneralChat'

// Admin chat hub: every project's chat + every general chat in one
// Discord-style view. Same message tables as the boards, so always in sync.
export default function AdminChatsPage() {
  const [projects, setProjects] = useState<HubProject[]>([])
  const [generalChats, setGeneralChats] = useState<GeneralChatInfo[]>([])
  const [loading, setLoading] = useState(true)
  const unread = useChatUnread({ self: 'admin' })

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: projs }, { data: chats }] = await Promise.all([
      supabase.from('projects').select('id, name, color').neq('status', 'archived').order('name'),
      supabase.from('general_chats').select('id, name').order('created_at'),
    ])
    setProjects((projs ?? []).map((p: { id: string; name: string; color: string | null }) => ({
      id: p.id,
      name: p.name,
      color: p.color ?? '#14b8a6',
    })))
    if (chats) setGeneralChats(chats as GeneralChatInfo[])
    setLoading(false)
  }

  async function createGeneralChat() {
    const name = window.prompt('Назва чату:')?.trim()
    if (!name) return
    const { data, error } = await supabase
      .from('general_chats')
      .insert({ name })
      .select('id, name')
      .single()
    if (error) { alert('Запусти міграцію general_chats_migration.sql'); return }
    if (data) setGeneralChats(prev => [...prev, data as GeneralChatInfo])
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Чати</h1>
      {loading ? (
        <p className="text-sm text-gray-400">Завантаження...</p>
      ) : (
        <ChatsHub
          projects={projects}
          generalChats={generalChats}
          sender={{ type: 'admin', name: 'Ivan' }}
          unread={unread}
          onCreateGeneral={createGeneralChat}
          onGeneralDeleted={id => setGeneralChats(prev => prev.filter(c => c.id !== id))}
        />
      )}
    </div>
  )
}
