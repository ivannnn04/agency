'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, Send, X, Users, UserRound } from 'lucide-react'

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
  const [dbError, setDbError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .eq('channel', channel)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) { setDbError(true); return }
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

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    const { data, error } = await supabase
      .from('project_messages')
      .insert({
        project_id: projectId,
        channel,
        sender_type: sender.type,
        sender_name: sender.name,
        team_member_id: sender.teamMemberId ?? null,
        content: text.slice(0, 4000),
      })
      .select()
      .single()
    setSending(false)
    if (!error && data) {
      setMessages(prev => [...prev, data as Message])
      setInput('')
    }
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
        {dbError && (
          <p className="text-xs text-red-400 text-center mt-8">
            Таблиця project_messages не знайдена — запусти supabase/client_portal_migration.sql
          </p>
        )}
        {!dbError && messages.length === 0 && (
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
                {m.content}
              </div>
              <p className={`text-[10px] text-gray-300 mt-0.5 px-1 ${mine ? 'text-right' : ''}`}>
                {new Date(m.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 p-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={2}
          placeholder={channel === 'team' ? 'Повідомлення команді...' : 'Повідомлення клієнту...'}
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors flex-shrink-0"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}
