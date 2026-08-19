'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, X, Hash, Trash2 } from 'lucide-react'
import {
  MentionComposer, MessageBody, Attachment, ChatPerson, fileTooBig, safeStoragePath, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips,
} from '@/components/chat/shared'
import { ChatSender } from '@/components/ProjectChat'

// General team chat drawer — chats that live outside any project.
// Visible to the admin and the whole team; clients never see these.

export interface GeneralChatInfo {
  id: string
  name: string
}

interface Message {
  id: string
  sender_type: 'admin' | 'team' | 'client' | 'bot'
  sender_name: string
  team_member_id: string | null
  content: string
  file_url: string | null
  file_name: string | null
  created_at: string
}

export default function GeneralChat({ chat, sender, onClose, onDeleted }: {
  chat: GeneralChatInfo
  sender: ChatSender
  onClose: () => void
  onDeleted?: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [people, setPeople] = useState<ChatPerson[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { width, startResize } = useChatWidth()

  // Everyone internal can be mentioned: admin + all team members
  useEffect(() => {
    ;(async () => {
      const { data: mems } = await supabase.from('team_members').select('name').order('name')
      setPeople([
        { name: 'Ivan', type: 'admin' },
        ...(mems ?? []).map(m => ({ name: m.name as string, type: 'team' as const })),
      ])
    })()
  }, [])

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('project_messages')
      .select('id, sender_type, sender_name, team_member_id, content, file_url, file_name, created_at')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: true })
      .limit(500)
    if (err) { setError('Запусти міграцію general_chats_migration.sql'); return }
    setMessages(data as Message[])

    const { data: rx } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, reactor_key, reactor_name')
      .eq('chat_id', chat.id)
    if (rx) {
      const map: Record<string, Reaction[]> = {}
      for (const r of rx as Reaction[]) {
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push(r)
      }
      setReactions(map)
    }
  }, [chat.id])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const mentionNames = people.map(p => p.name)

  function isMine(m: Message) {
    if (sender.type === 'admin') return m.sender_type === 'admin'
    return m.sender_type === 'team' && m.team_member_id === (sender.teamMemberId ?? null)
  }

  async function insertMessage(content: string, fileUrl?: string, fileName?: string) {
    const { data, error: err } = await supabase
      .from('project_messages')
      .insert({
        chat_id: chat.id,
        project_id: null,
        channel: 'team',
        sender_type: sender.type,
        sender_name: sender.name,
        team_member_id: sender.teamMemberId ?? null,
        content: content.slice(0, 4000),
        file_url: fileUrl ?? null,
        file_name: fileName ?? null,
      })
      .select()
      .single()
    if (!err && data) {
      setMessages(prev => [...prev, data as Message])
      setInput('')
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    await insertMessage(text)
    setSending(false)
  }

  async function sendFile(f: File) {
    setError('')
    if (fileTooBig(f)) { setError(`Файл завеликий — максимум ${MAX_FILE_MB} МБ`); return }
    setUploading(true)
    const path = safeStoragePath(`chat-${chat.id}`, f.name)
    const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f)
    if (upErr) {
      setUploading(false)
      setError('Не вдалося завантажити файл')
      return
    }
    const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
    await insertMessage(input.trim(), pub.publicUrl, f.name)
    setUploading(false)
  }

  const myReactorKey = sender.type === 'admin' ? 'admin' : `team:${sender.teamMemberId}`

  async function toggleReaction(messageId: string, emoji: string) {
    const existing = (reactions[messageId] ?? []).find(
      r => r.emoji === emoji && r.reactor_key === myReactorKey
    )
    if (existing) {
      setReactions(prev => ({
        ...prev,
        [messageId]: (prev[messageId] ?? []).filter(r => !(r.emoji === emoji && r.reactor_key === myReactorKey)),
      }))
      await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('emoji', emoji)
        .eq('reactor_key', myReactorKey)
    } else {
      setReactions(prev => ({
        ...prev,
        [messageId]: [...(prev[messageId] ?? []), { message_id: messageId, emoji, reactor_key: myReactorKey, reactor_name: sender.name }],
      }))
      await supabase.from('message_reactions').insert({
        message_id: messageId,
        chat_id: chat.id,
        project_id: null,
        emoji,
        reactor_key: myReactorKey,
        reactor_name: sender.name,
      })
    }
  }

  async function deleteChat() {
    if (!window.confirm(`Видалити чат «${chat.name}» разом з усіма повідомленнями?`)) return
    await supabase.from('general_chats').delete().eq('id', chat.id)
    onDeleted?.()
    onClose()
  }

  return (
    <div
      className="fixed right-0 top-0 h-full bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width }}
    >
      <ChatResizeHandle onMouseDown={startResize} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Hash size={15} className="text-teal-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-gray-800 truncate">{chat.name}</p>
        </div>
        <div className="flex items-center gap-1">
          {sender.type === 'admin' && (
            <button
              onClick={deleteChat}
              className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors"
              title="Видалити чат"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && !error && (
          <p className="text-xs text-gray-300 text-center mt-8 flex flex-col items-center gap-2">
            <MessageSquare size={22} className="opacity-40" />
            Ще немає повідомлень
          </p>
        )}
        {messages.map(m => {
          const mine = isMine(m)
          return (
            <div key={m.id} className={`max-w-[85%] group ${mine ? 'self-end' : 'self-start'}`}>
              {!mine && (
                <p className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {m.sender_name}
                  {m.sender_type === 'admin' && ' · адмін'}
                </p>
              )}
              <div className={`flex items-center gap-0.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <div className={`min-w-0 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  mine ? 'bg-gray-900 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  <MessageBody content={m.content} names={mentionNames} mine={mine} />
                  {m.file_url && (
                    <Attachment url={m.file_url} name={m.file_name ?? 'file'} mine={mine} />
                  )}
                </div>
                <ReactionPicker mine={mine} onPick={emoji => toggleReaction(m.id, emoji)} />
              </div>
              <ReactionChips
                reactions={reactions[m.id] ?? []}
                myKey={myReactorKey}
                onToggle={emoji => toggleReaction(m.id, emoji)}
                mine={mine}
              />
              <p className={`text-[10px] text-gray-300 mt-0.5 px-1 ${mine ? 'text-right' : ''}`}>
                {new Date(m.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="text-[11px] text-red-500 px-4 py-1.5 border-t border-red-100 bg-red-50 flex-shrink-0">{error}</p>
      )}

      <MentionComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onPickFile={sendFile}
        people={people}
        placeholder="Повідомлення... (@ — згадати)"
        uploading={uploading}
        accent="dark"
      />
    </div>
  )
}
