'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, X, Users, UserRound } from 'lucide-react'
import {
  MentionComposer, MessageBody, Attachment, ChatPerson, fileTooBig, safeStoragePath, MAX_FILE_MB,
} from '@/components/chat/shared'

export interface ChatSender {
  type: 'admin' | 'team'
  name: string
  teamMemberId?: string | null
}

interface Message {
  id: string
  channel: 'team' | 'client'
  sender_type: 'admin' | 'team' | 'client'
  sender_name: string
  team_member_id: string | null
  content: string
  file_url: string | null
  file_name: string | null
  created_at: string
}

// Right-side chat drawer for internal users (admin + team members).
// Two channels: 'team' (internal only) and 'client' (visible to the client portal).
export default function ProjectChat({ projectId, sender, onClose }: {
  projectId: string
  sender: ChatSender
  onClose: () => void
}) {
  const [channel, setChannel] = useState<'team' | 'client'>('team')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [people, setPeople] = useState<ChatPerson[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Mentionable people: admin + project team members + project clients
  useEffect(() => {
    ;(async () => {
      const [{ data: pm }, { data: pc }] = await Promise.all([
        supabase.from('project_members').select('team_members(name)').eq('project_id', projectId),
        supabase.from('project_clients').select('clients(name, email)').eq('project_id', projectId),
      ])
      const team: ChatPerson[] = (pm ?? [])
        .map(r => (r as unknown as { team_members: { name: string } | null }).team_members?.name)
        .filter((n): n is string => !!n)
        .map(name => ({ name, type: 'team' as const }))
      const clients: ChatPerson[] = (pc ?? [])
        .map(r => (r as unknown as { clients: { name: string | null; email: string } | null }).clients)
        .filter((c): c is { name: string | null; email: string } => !!c)
        .map(c => ({ name: c.name || c.email, type: 'client' as const }))
      setPeople([{ name: 'Ivan', type: 'admin' }, ...team, ...clients])
    })()
  }, [projectId])

  const mentionable = channel === 'team' ? people.filter(p => p.type !== 'client') : people
  const mentionNames = people.map(p => p.name)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .eq('channel', channel)
      .order('created_at', { ascending: true })
      .limit(500)
    if (err) { setError('Таблиця project_messages не знайдена — запусти міграції з папки supabase/'); return }
    setMessages(data as Message[])
  }, [projectId, channel])

  useEffect(() => {
    setMessages([])
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function insertMessage(content: string, fileUrl?: string, fileName?: string) {
    const { data, error: err } = await supabase
      .from('project_messages')
      .insert({
        project_id: projectId,
        channel,
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
    const path = safeStoragePath(projectId, f.name)
    const { error: upErr } = await supabase.storage.from('chat-files').upload(path, f)
    if (upErr) {
      setUploading(false)
      setError('Не вдалося завантажити файл — перевір, чи запущена міграція chat_files_migration.sql')
      return
    }
    const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
    await insertMessage(input.trim(), pub.publicUrl, f.name)
    setUploading(false)
  }

  function isMine(m: Message) {
    if (sender.type === 'admin') return m.sender_type === 'admin'
    return m.sender_type === 'team' && m.team_member_id === (sender.teamMemberId ?? null)
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[380px] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
      {/* Header with channel tabs */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setChannel('team')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              channel === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Users size={12} /> Команда
          </button>
          <button
            onClick={() => setChannel('client')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              channel === 'client' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <UserRound size={12} /> Клієнт
          </button>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      {channel === 'client' && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <p className="text-[11px] text-amber-700">Цей канал бачить клієнт — пишіть як для клієнта 😉</p>
        </div>
      )}

      {/* Messages */}
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
            <div key={m.id} className={`max-w-[85%] ${mine ? 'self-end' : 'self-start'}`}>
              {!mine && (
                <p className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {m.sender_name}
                  {m.sender_type === 'client' && <span className="text-teal-500"> · клієнт</span>}
                  {m.sender_type === 'admin' && ' · адмін'}
                </p>
              )}
              <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                mine
                  ? 'bg-gray-900 text-white rounded-br-md'
                  : m.sender_type === 'client'
                    ? 'bg-teal-50 text-gray-800 border border-teal-100 rounded-bl-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                <MessageBody content={m.content} names={mentionNames} mine={mine} />
                {m.file_url && (
                  <Attachment url={m.file_url} name={m.file_name ?? 'file'} mine={mine} />
                )}
              </div>
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

      {/* Composer with mentions + attachments */}
      <MentionComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onPickFile={sendFile}
        people={mentionable}
        placeholder={channel === 'team' ? 'Повідомлення команді... (@ — згадати)' : 'Повідомлення клієнту... (@ — згадати)'}
        uploading={uploading}
        accent="dark"
      />
    </div>
  )
}
