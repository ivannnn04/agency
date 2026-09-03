'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, X, Hash, Trash2, Users, Pin, CornerUpLeft, Phone } from 'lucide-react'
import VoiceRoom from '@/components/chat/VoiceRoom'
import {
  MentionComposer, MessageBody, Attachment, ChatPerson, fileTooBig, safeStoragePath, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips,
} from '@/components/chat/shared'
import { ChatSender } from '@/components/ProjectChat'
import { markRead } from '@/lib/chatUnread'

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
  pinned?: boolean | null
  reply_to_message_id?: string | null
  created_at: string
}

// embedded renders the chat in-flow (Discord-style hub pane) instead of a drawer.
export default function GeneralChat({ chat, sender, onClose, onDeleted, embedded }: {
  chat: GeneralChatInfo
  sender: ChatSender
  onClose: () => void
  onDeleted?: () => void
  embedded?: boolean
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [people, setPeople] = useState<ChatPerson[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const { width, startResize } = useChatWidth()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [inVoice, setInVoice] = useState(false)

  async function togglePin(m: Message) {
    const next = !m.pinned
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, pinned: next } : x))
    const { error: err } = await supabase
      .from('project_messages')
      .update({ pinned: next })
      .eq('id', m.id)
    if (err) setError('Закріплення не збереглося — запусти міграцію chat_pins_migration.sql')
  }

  function scrollToMessage(id: string) {
    msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Admin-only membership management: no rows = the whole team sees the chat
  const [manageOpen, setManageOpen] = useState(false)
  const [allMembers, setAllMembers] = useState<{ id: string; name: string; color: string }[]>([])
  const [chatMemberIds, setChatMemberIds] = useState<Set<string>>(new Set())
  const [membersSupported, setMembersSupported] = useState(true)

  // Everyone internal can be mentioned: admin + all team members
  useEffect(() => {
    ;(async () => {
      const { data: mems } = await supabase.from('team_members').select('id, name, color').order('name')
      const rows = (mems ?? []) as { id: string; name: string; color: string }[]
      setAllMembers(rows)
      setPeople([
        { name: 'Ivan', type: 'admin' },
        ...rows.map(m => ({ name: m.name, type: 'team' as const })),
      ])
    })()
  }, [])

  useEffect(() => {
    if (sender.type !== 'admin') return
    ;(async () => {
      const { data, error: err } = await supabase
        .from('general_chat_members')
        .select('team_member_id')
        .eq('chat_id', chat.id)
      if (err) { setMembersSupported(false); return }
      setChatMemberIds(new Set((data ?? []).map((r: { team_member_id: string }) => r.team_member_id)))
    })()
  }, [chat.id, sender.type])

  async function toggleChatMember(teamMemberId: string) {
    const next = new Set(chatMemberIds)
    if (next.has(teamMemberId)) {
      next.delete(teamMemberId)
      setChatMemberIds(next)
      await supabase
        .from('general_chat_members')
        .delete()
        .eq('chat_id', chat.id)
        .eq('team_member_id', teamMemberId)
    } else {
      next.add(teamMemberId)
      setChatMemberIds(next)
      await supabase
        .from('general_chat_members')
        .insert({ chat_id: chat.id, team_member_id: teamMemberId })
    }
  }

  const load = useCallback(async () => {
    // pinned / reply_to columns may not be migrated yet — drop them one by one
    const BASE_COLS = 'id, sender_type, sender_name, team_member_id, content, file_url, file_name, created_at'
    const attempts = [
      `${BASE_COLS}, pinned, reply_to_message_id`,
      `${BASE_COLS}, pinned`,
      BASE_COLS,
    ]
    let rows: Message[] | null = null
    let err: { message: string } | null = null
    for (const cols of attempts) {
      const res = await supabase
        .from('project_messages')
        .select(cols)
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: true })
        .limit(500)
      rows = res.data as Message[] | null
      err = res.error
      if (!err) break
      if (!err.message.includes('pinned') && !err.message.includes('reply_to_message_id')) break
    }
    if (err) { setError('Запусти міграцію general_chats_migration.sql'); return }
    setMessages(rows ?? [])

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

  // Viewing the chat marks it read (clears the unread counters elsewhere)
  useEffect(() => {
    markRead(`chat:${chat.id}`, 'team')
  }, [chat.id, messages.length])

  const mentionNames = people.map(p => p.name)

  function isMine(m: Message) {
    if (sender.type === 'admin') return m.sender_type === 'admin'
    return m.sender_type === 'team' && m.team_member_id === (sender.teamMemberId ?? null)
  }

  async function insertMessage(content: string, fileUrl?: string, fileName?: string) {
    const base = {
      chat_id: chat.id,
      project_id: null,
      channel: 'team',
      sender_type: sender.type,
      sender_name: sender.name,
      team_member_id: sender.teamMemberId ?? null,
      content: content.slice(0, 4000),
      file_url: fileUrl ?? null,
      file_name: fileName ?? null,
    }
    let { data, error: err } = await supabase
      .from('project_messages')
      .insert({ ...base, reply_to_message_id: replyTo?.id ?? null })
      .select()
      .single()
    if (err && err.message.includes('reply_to_message_id')) {
      if (replyTo) setError('Відповіді не збережуться — запусти міграцію chat_replies_migration.sql')
      ;({ data, error: err } = await supabase.from('project_messages').insert(base).select().single())
    }
    if (!err && data) {
      setMessages(prev => [...prev, data as Message])
      setInput('')
      setReplyTo(null)
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
      className={embedded
        ? 'h-full w-full min-w-0 bg-white flex flex-col'
        : 'fixed right-0 top-0 h-full max-w-[100vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col'}
      style={embedded ? undefined : { width }}
    >
      {!embedded && <ChatResizeHandle onMouseDown={startResize} />}

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Hash size={15} className="text-teal-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-gray-800 truncate">{chat.name}</p>
          <span className="text-[10px] text-gray-400 flex-shrink-0">загальний чат</span>
        </div>
        <div className="flex items-center gap-1">
          {!inVoice && (
            <button
              onClick={() => setInVoice(true)}
              className="text-gray-400 hover:text-teal-600 p-1.5 rounded-lg hover:bg-teal-50 transition-colors"
              title="Голосовий канал"
            >
              <Phone size={14} />
            </button>
          )}
          {sender.type === 'admin' && (
            <>
              <button
                onClick={() => setManageOpen(v => !v)}
                className={`p-1 rounded transition-colors ${manageOpen ? 'text-teal-500' : 'text-gray-300 hover:text-teal-500'}`}
                title="Учасники чату"
              >
                <Users size={14} />
              </button>
              <button
                onClick={deleteChat}
                className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors"
                title="Видалити чат"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {!embedded && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
          )}
        </div>
      </div>

      {/* Admin: pick who sees this chat. No one selected = the whole team sees it. */}
      {manageOpen && sender.type === 'admin' && (
        <div className="border-b border-gray-100 px-4 py-3 flex-shrink-0 bg-gray-50">
          {!membersSupported ? (
            <p className="text-[11px] text-red-500">Запусти міграцію general_chat_members_migration.sql</p>
          ) : (
            <>
              <p className="text-[11px] text-gray-400 mb-2">
                {chatMemberIds.size === 0
                  ? 'Нікого не обрано — чат бачить вся команда'
                  : 'Чат бачать тільки обрані учасники (і адмін)'}
              </p>
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                {allMembers.map(m => {
                  const on = chatMemberIds.has(m.id)
                  return (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:bg-white rounded-lg px-2 py-1.5 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleChatMember(m.id)}
                        className="accent-teal-500"
                      />
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold flex-shrink-0"
                        style={{ backgroundColor: m.color || '#14b8a6' }}
                      >
                        {m.name.charAt(0)}
                      </span>
                      {m.name}
                    </label>
                  )
                })}
                {allMembers.length === 0 && (
                  <p className="text-[11px] text-gray-300">Немає учасників команди</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Live voice room */}
      {inVoice && (
        <VoiceRoom
          roomKey={`chat-${chat.id}`}
          self={{
            key: sender.type === 'admin' ? 'admin' : `team-${sender.teamMemberId}`,
            name: sender.name,
            color: sender.type === 'admin' ? '#0ea5e9' : '#14b8a6',
          }}
          onLeave={() => setInVoice(false)}
        />
      )}

      {/* Pinned messages strip */}
      {messages.some(m => m.pinned) && (
        <div className="border-b border-amber-100 bg-amber-50/70 flex-shrink-0 max-h-28 overflow-y-auto">
          {messages.filter(m => m.pinned).map(m => (
            <div key={m.id} className="flex items-center gap-2 px-4 py-1.5">
              <Pin size={11} className="text-amber-500 flex-shrink-0" />
              <button
                onClick={() => scrollToMessage(m.id)}
                className="flex-1 min-w-0 text-left text-[11px] text-gray-700 truncate hover:text-gray-900"
                title="Показати повідомлення"
              >
                <span className="font-semibold">{m.sender_name}:</span> {m.content || m.file_name || 'файл'}
              </button>
              <button
                onClick={() => togglePin(m)}
                className="text-gray-300 hover:text-red-400 flex-shrink-0 p-0.5"
                title="Відкріпити"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

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
            <div
              key={m.id}
              ref={el => { msgRefs.current[m.id] = el }}
              className={`max-w-[85%] group ${mine ? 'self-end' : 'self-start'}`}
            >
              {m.pinned && (
                <p className={`flex items-center gap-1 text-[9px] text-amber-500 mb-0.5 px-1 ${mine ? 'justify-end' : ''}`}>
                  <Pin size={9} /> закріплено
                </p>
              )}
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
                  {m.reply_to_message_id && (() => {
                    const orig = messages.find(x => x.id === m.reply_to_message_id)
                    if (!orig) return null
                    return (
                      <button
                        onClick={() => scrollToMessage(orig.id)}
                        className={`block w-full text-left mb-1.5 rounded-lg px-2 py-1 text-[11px] border-l-2 ${
                          mine ? 'bg-white/10 border-white/40 text-gray-300' : 'bg-black/5 border-gray-300 text-gray-500'
                        }`}
                      >
                        <span className="font-semibold block">{orig.sender_name}</span>
                        <span className="block truncate">{orig.content || orig.file_name || 'файл'}</span>
                      </button>
                    )
                  })()}
                  <MessageBody content={m.content} names={mentionNames} mine={mine} />
                  {m.file_url && (
                    <Attachment url={m.file_url} name={m.file_name ?? 'file'} mine={mine} />
                  )}
                </div>
                <ReactionPicker mine={mine} onPick={emoji => toggleReaction(m.id, emoji)} />
                <button
                  onClick={() => setReplyTo(m)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded transition-all flex-shrink-0 text-gray-300 hover:text-teal-500"
                  title="Відповісти"
                >
                  <CornerUpLeft size={12} />
                </button>
                <button
                  onClick={() => togglePin(m)}
                  className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all flex-shrink-0 ${
                    m.pinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-500'
                  }`}
                  title={m.pinned ? 'Відкріпити' : 'Закріпити'}
                >
                  <Pin size={12} />
                </button>
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

      {/* Replying-to preview */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <CornerUpLeft size={13} className="text-teal-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-gray-600">{replyTo.sender_name}</p>
            <p className="text-[11px] text-gray-400 truncate">{replyTo.content || replyTo.file_name || 'файл'}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-gray-300 hover:text-gray-600 p-1 rounded flex-shrink-0">
            <X size={13} />
          </button>
        </div>
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
        onVoice={sendFile}
      />
    </div>
  )
}
