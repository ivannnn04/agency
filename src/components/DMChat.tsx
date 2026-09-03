'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, X, Phone, Pin, CornerUpLeft } from 'lucide-react'
import {
  MentionComposer, MessageBody, Attachment, fileTooBig, safeStoragePath, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips,
} from '@/components/chat/shared'
import { ChatSender } from '@/components/ProjectChat'
import { markRead } from '@/lib/chatUnread'
import VoiceRoom from '@/components/chat/VoiceRoom'

// Direct messages between two internal users (admin + team). Never shown
// to clients. Rows live in project_messages with dm_key = sorted pair.

export interface DMPeer {
  key: string   // 'admin' or 'team-<id>'
  name: string
  color: string
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

export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join('|')
}

export default function DMChat({ peer, sender, onClose, embedded }: {
  peer: DMPeer
  sender: ChatSender
  onClose: () => void
  embedded?: boolean
}) {
  const selfKey = sender.type === 'admin' ? 'admin' : `team-${sender.teamMemberId}`
  const dmKey = dmKeyFor(selfKey, peer.key)

  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [inVoice, setInVoice] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const { width, startResize } = useChatWidth()

  const mentionNames = [sender.name, peer.name]

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('project_messages')
      .select('*')
      .eq('dm_key', dmKey)
      .order('created_at', { ascending: true })
      .limit(500)
    if (err) { setError('Запусти міграцію direct_messages_migration.sql'); return }
    const rows = (data ?? []) as Message[]
    setMessages(rows)

    const ids = rows.map(m => m.id)
    if (ids.length > 0) {
      const { data: rx } = await supabase
        .from('message_reactions')
        .select('message_id, emoji, reactor_key, reactor_name')
        .in('message_id', ids)
      if (rx) {
        const map: Record<string, Reaction[]> = {}
        for (const r of rx as Reaction[]) {
          if (!map[r.message_id]) map[r.message_id] = []
          map[r.message_id].push(r)
        }
        setReactions(map)
      }
    }
  }, [dmKey])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Viewing marks the DM read
  useEffect(() => {
    markRead(`dm:${dmKey}`, 'team')
  }, [dmKey, messages.length])

  function isMine(m: Message) {
    if (sender.type === 'admin') return m.sender_type === 'admin'
    return m.sender_type === 'team' && m.team_member_id === (sender.teamMemberId ?? null)
  }

  async function insertMessage(content: string, fileUrl?: string, fileName?: string) {
    const { data, error: err } = await supabase
      .from('project_messages')
      .insert({
        dm_key: dmKey,
        project_id: null,
        channel: 'team',
        sender_type: sender.type,
        sender_name: sender.name,
        team_member_id: sender.teamMemberId ?? null,
        content: content.slice(0, 4000),
        file_url: fileUrl ?? null,
        file_name: fileName ?? null,
        reply_to_message_id: replyTo?.id ?? null,
      })
      .select()
      .single()
    if (err) { setError('Запусти міграцію direct_messages_migration.sql'); return }
    if (data) {
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
    const path = safeStoragePath(`dm-${dmKey.replace(/[^a-zA-Z0-9-]/g, '_')}`, f.name)
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
        emoji,
        reactor_key: myReactorKey,
        reactor_name: sender.name,
      })
    }
  }

  async function togglePin(m: Message) {
    const next = !m.pinned
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, pinned: next } : x))
    await supabase.from('project_messages').update({ pinned: next }).eq('id', m.id)
  }

  function scrollToMessage(id: string) {
    msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
            style={{ backgroundColor: peer.color }}
          >
            {peer.name.charAt(0)}
          </span>
          <p className="text-sm font-semibold text-gray-800 truncate">{peer.name}</p>
          <span className="text-[10px] text-gray-400 flex-shrink-0">особисті</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!inVoice && (
            <button
              onClick={() => setInVoice(true)}
              className="text-gray-400 hover:text-teal-600 p-1.5 rounded-lg hover:bg-teal-50 transition-colors"
              title="Подзвонити"
            >
              <Phone size={14} />
            </button>
          )}
          {!embedded && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
          )}
        </div>
      </div>

      {inVoice && (
        <VoiceRoom
          roomKey={`dm-${dmKey}`}
          roomName={peer.name}
          self={{
            key: selfKey,
            name: sender.name,
            color: sender.type === 'admin' ? '#0ea5e9' : '#14b8a6',
          }}
          onLeave={() => setInVoice(false)}
        />
      )}

      {/* Pinned strip */}
      {messages.some(m => m.pinned) && (
        <div className="border-b border-amber-100 bg-amber-50/70 flex-shrink-0 max-h-28 overflow-y-auto">
          {messages.filter(m => m.pinned).map(m => (
            <div key={m.id} className="flex items-center gap-2 px-4 py-1.5">
              <Pin size={11} className="text-amber-500 flex-shrink-0" />
              <button
                onClick={() => scrollToMessage(m.id)}
                className="flex-1 min-w-0 text-left text-[11px] text-gray-700 truncate hover:text-gray-900"
              >
                <span className="font-semibold">{m.sender_name}:</span> {m.content || m.file_name || 'файл'}
              </button>
              <button onClick={() => togglePin(m)} className="text-gray-300 hover:text-red-400 flex-shrink-0 p-0.5" title="Відкріпити">
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
            Напиши перше повідомлення 👋
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
        people={[]}
        placeholder={`Повідомлення для ${peer.name}...`}
        uploading={uploading}
        accent="dark"
        onVoice={sendFile}
      />
    </div>
  )
}
