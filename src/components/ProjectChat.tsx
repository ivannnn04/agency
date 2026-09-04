'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, X, Users, UserRound, Bot, Check, Pencil, Trash2, Loader2, Hash, Pin, CornerUpLeft, Phone } from 'lucide-react'
import { startCall } from '@/lib/callBus'
import { getAdminProfile } from '@/lib/adminProfile'
import {
  MentionComposer, MessageBody, Attachment, ChatPerson, fileTooBig, safeStoragePath, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, Reaction, ReactionPicker, ReactionChips, DropZone, groupMessages, GalleryBubble, MessageActions, MessageEditBox,
} from '@/components/chat/shared'
import { getLastRead, markRead } from '@/lib/chatUnread'

export interface ChatSender {
  type: 'admin' | 'team'
  name: string
  teamMemberId?: string | null
}

interface Message {
  id: string
  channel: 'team' | 'client'
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

interface Digest {
  id: string
  draft: string
  created_at: string
}

// Right-side chat drawer for internal users (admin + team members).
// Two channels: 'team' (internal only) and 'client' (visible to the client portal).
// projectName shows in the header so it's always clear whose chat this is.
// embedded renders the chat in-flow (Discord-style hub pane) instead of a drawer.
export default function ProjectChat({ projectId, projectName, sender, onClose, embedded }: {
  projectId: string
  projectName?: string
  sender: ChatSender
  onClose: () => void
  embedded?: boolean
}) {
  const [channel, setChannel] = useState<'team' | 'client'>('team')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [people, setPeople] = useState<ChatPerson[]>([])
  const [digest, setDigest] = useState<Digest | null>(null)
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [digestEdit, setDigestEdit] = useState<string | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const { width, startResize } = useChatWidth()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Replying makes no sense across channels
  useEffect(() => { setReplyTo(null) }, [channel])

  // Pin/unpin a message; the pinned strip sits under the header
  async function togglePin(m: Message) {
    const next = !m.pinned
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, pinned: next } : x))
    const { error: err } = await supabase
      .from('project_messages')
      .update({ pinned: next })
      .eq('id', m.id)
    if (err) setError('Закріплення не збереглося — запусти міграцію chat_pins_migration.sql')
  }

  async function saveEdit(m: Message, text: string) {
    const t = text.trim()
    setEditingId(null)
    if (!t || t === m.content) return
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, content: t } : x))
    await supabase.from('project_messages').update({ content: t.slice(0, 4000) }).eq('id', m.id)
  }

  async function deleteMessage(m: Message) {
    if (!window.confirm('Видалити повідомлення?')) return
    setMessages(prev => prev.filter(x => x.id !== m.id))
    await supabase.from('message_reactions').delete().eq('message_id', m.id)
    await supabase.from('project_messages').delete().eq('id', m.id)
  }

  function scrollToMessage(id: string) {
    msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

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
      const admin = await getAdminProfile()
      setPeople([{ name: admin.name, type: 'admin' }, ...team, ...clients])
    })()
  }, [projectId])

  const mentionable = channel === 'team' ? people.filter(p => p.type !== 'client') : people
  const mentionNames = people.map(p => p.name)

  // Both channels come in one poll — the inactive tab can show an unread badge
  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(500)
    if (err) { setError('Таблиця project_messages не знайдена — запусти міграції з папки supabase/'); return }
    setMessages(data as Message[])

    // Reactions come in one project-wide query (table may not exist yet)
    const { data: rx } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, reactor_key, reactor_name')
      .eq('project_id', projectId)
    if (rx) {
      const map: Record<string, Reaction[]> = {}
      for (const r of rx as Reaction[]) {
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push(r)
      }
      setReactions(map)
    }

    // Pending AI digest draft (shown in the team channel until approved/dismissed)
    const { data: dg } = await supabase
      .from('daily_digests')
      .select('id, draft, created_at')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
    setDigest(dg && dg.length > 0 ? (dg[0] as Digest) : null)
  }, [projectId])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  const channelMessages = messages.filter(m => m.channel === channel)

  function isMine(m: Message) {
    if (sender.type === 'admin') return m.sender_type === 'admin'
    return m.sender_type === 'team' && m.team_member_id === (sender.teamMemberId ?? null)
  }

  function channelHasUnread(ch: 'team' | 'client') {
    const lastRead = getLastRead(projectId, ch)
    return messages.some(m => m.channel === ch && !isMine(m) && m.created_at > lastRead)
  }

  const teamTabUnread = channel !== 'team' && channelHasUnread('team')
  const clientTabUnread = channel !== 'client' && channelHasUnread('client')
  const clientWrote = messages.some(m =>
    m.channel === 'client' && m.sender_type === 'client' && m.created_at > getLastRead(projectId, 'client'))

  // Viewing a channel marks it read (and clears the sidebar highlight)
  useEffect(() => {
    if (channelHasUnread(channel)) markRead(projectId, channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, messages.length, projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages.length, channel])

  async function insertMessage(content: string, fileUrl?: string, fileName?: string) {
    const base = {
      project_id: projectId,
      channel,
      sender_type: sender.type,
      sender_name: sender.name,
      team_member_id: sender.teamMemberId ?? null,
      content: content.slice(0, 4000),
      file_url: fileUrl ?? null,
      file_name: fileName ?? null,
    }
    // reply_to column may not be migrated yet — retry without it
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


  // Batch send (drop / multi-select): text goes with the first file only,
  // so a pack of photos collapses into a gallery
  async function sendFiles(fs: File[]) {
    for (let i = 0; i < fs.length; i++) await sendFile(fs[i], i === 0)
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
      const optimistic: Reaction = {
        message_id: messageId, emoji, reactor_key: myReactorKey, reactor_name: sender.name,
      }
      setReactions(prev => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), optimistic] }))
      const { error: rxErr } = await supabase.from('message_reactions').insert({
        message_id: messageId,
        project_id: projectId,
        emoji,
        reactor_key: myReactorKey,
        reactor_name: sender.name,
      })
      if (rxErr) setError('Реакції не збережуться — запусти міграцію chat_reactions_migration.sql')
    }
  }

  async function sendFile(f: File, withText = true) {
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
    await insertMessage(withText ? input.trim() : '', pub.publicUrl, f.name)
    setUploading(false)
  }

  // ── AI daily digest (draft → admin approves → bot posts to the client) ──────

  async function saveDigestEdit() {
    if (!digest || digestEdit === null) return
    const text = digestEdit.trim()
    if (!text) return
    setDigestBusy(true)
    const { error: err } = await supabase
      .from('daily_digests')
      .update({ draft: text })
      .eq('id', digest.id)
    if (!err) {
      setDigest({ ...digest, draft: text })
      setDigestEdit(null)
    }
    setDigestBusy(false)
  }

  async function approveDigest() {
    if (!digest || digestBusy) return
    const text = (digestEdit ?? digest.draft).trim()
    if (!text) return
    setDigestBusy(true)
    const { data, error: err } = await supabase
      .from('project_messages')
      .insert({
        project_id: projectId,
        channel: 'client',
        sender_type: 'bot',
        sender_name: 'Gudrix AI',
        content: text.slice(0, 4000),
      })
      .select()
      .single()
    if (err) {
      setError('Не вдалося надіслати — перевір, чи запущена міграція daily_digest_migration.sql')
      setDigestBusy(false)
      return
    }
    await supabase
      .from('daily_digests')
      .update({ draft: text, status: 'approved', sent_at: new Date().toISOString() })
      .eq('id', digest.id)
    setMessages(prev => [...prev, data as Message])
    setDigest(null)
    setDigestEdit(null)
    setDigestBusy(false)
  }

  async function dismissDigest() {
    if (!digest || digestBusy) return
    setDigestBusy(true)
    await supabase.from('daily_digests').update({ status: 'dismissed' }).eq('id', digest.id)
    setDigest(null)
    setDigestEdit(null)
    setDigestBusy(false)
  }

  return (
    <DropZone
      onFiles={sendFiles}
      className={embedded
        ? 'relative h-full w-full min-w-0 bg-white flex flex-col'
        : 'fixed right-0 top-0 h-full max-w-[100vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col'}
      style={embedded ? undefined : { width }}
    >
      {!embedded && <ChatResizeHandle onMouseDown={startResize} />}
      {/* Header: which chat this is + channel tabs */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Hash size={15} className="text-teal-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-gray-800 truncate">{projectName ?? 'Проєкт'}</p>
            <span className="text-[10px] text-gray-400 flex-shrink-0">чат проєкту</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => startCall({ roomKey: `project-${projectId}`, roomName: projectName ?? 'Проєкт' })}
              className="text-gray-400 hover:text-teal-600 p-1.5 rounded-lg hover:bg-teal-50 transition-colors"
              title="Голосовий канал (тільки команда)"
            >
              <Phone size={14} />
            </button>
            {!embedded && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setChannel('team')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              channel === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Users size={12} /> Команда
            {teamTabUnread && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
          </button>
          <button
            onClick={() => setChannel('client')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              channel === 'client' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <UserRound size={12} /> Клієнт
            {clientTabUnread && (
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${clientWrote ? 'bg-amber-400' : 'bg-teal-400'}`}
                title={clientWrote ? 'Клієнт написав' : 'Нове повідомлення'}
              />
            )}
          </button>
        </div>
      </div>

      {channel === 'client' && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <p className="text-[11px] text-amber-700">Цей канал бачить клієнт — пишіть як для клієнта 😉</p>
        </div>
      )}

      {/* Pinned messages strip */}
      {channelMessages.some(m => m.pinned) && (
        <div className="border-b border-amber-100 bg-amber-50/70 flex-shrink-0 max-h-28 overflow-y-auto">
          {channelMessages.filter(m => m.pinned).map(m => (
            <div key={m.id} className="flex items-center gap-2 px-4 py-1.5 group/pin">
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {/* AI digest draft card — team channel only */}
        {channel === 'team' && digest && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-violet-500 text-white flex items-center justify-center flex-shrink-0">
                <Bot size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-violet-800 leading-tight">Gudrix AI — ранковий апдейт для клієнта</p>
                <p className="text-[10px] text-violet-400 leading-tight">
                  чернетка · {new Date(digest.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            {digestEdit !== null ? (
              <textarea
                value={digestEdit}
                onChange={e => setDigestEdit(e.target.value)}
                rows={8}
                className="w-full text-sm border border-violet-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y leading-relaxed"
              />
            ) : (
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-white rounded-xl px-3 py-2.5 border border-violet-100">
                {digest.draft}
              </p>
            )}

            {sender.type === 'admin' ? (
              <div className="flex items-center gap-2">
                {digestEdit !== null ? (
                  <>
                    <button
                      onClick={saveDigestEdit}
                      disabled={digestBusy || !digestEdit.trim()}
                      className="flex items-center gap-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {digestBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Зберегти
                    </button>
                    <button
                      onClick={() => setDigestEdit(null)}
                      disabled={digestBusy}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-white transition-colors"
                    >
                      Скасувати
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={approveDigest}
                      disabled={digestBusy}
                      className="flex items-center gap-1.5 text-xs font-medium bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {digestBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Апрув — надіслати клієнту
                    </button>
                    <button
                      onClick={() => setDigestEdit(digest.draft)}
                      disabled={digestBusy}
                      className="flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900 px-3 py-1.5 rounded-lg hover:bg-white transition-colors"
                    >
                      <Pencil size={12} /> Редагувати
                    </button>
                    <button
                      onClick={dismissDigest}
                      disabled={digestBusy}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-red-500 px-2 py-1.5 rounded-lg hover:bg-white transition-colors ml-auto"
                      title="Відхилити чернетку"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-violet-400">Чекає на апрув адміна</p>
            )}
          </div>
        )}

        {channelMessages.length === 0 && !error && (
          <p className="text-xs text-gray-300 text-center mt-8 flex flex-col items-center gap-2">
            <MessageSquare size={22} className="opacity-40" />
            Ще немає повідомлень
          </p>
        )}
        {groupMessages(channelMessages).map(item => {
          if (Array.isArray(item)) {
            const first = item[0]
            const gm = isMine(first)
            return (
              <GalleryBubble
                key={first.id}
                images={item.map(x => ({ url: x.file_url as string, name: x.file_name ?? 'image' }))}
                mine={gm}
                senderName={!gm ? first.sender_name : undefined}
                timestamp={item[item.length - 1].created_at}
              />
            )
          }
          const m = item
          const mine = isMine(m)
          return (
            <div
              key={m.id}
              ref={el => { msgRefs.current[m.id] = el }}
              className={`relative max-w-[85%] group ${mine ? 'self-end' : 'self-start'}`}
            >
              <MessageActions
                mine={mine}
                pinned={!!m.pinned}
                canEdit={mine}
                canDelete={mine || sender.type === 'admin'}
                onReact={emoji => toggleReaction(m.id, emoji)}
                onReply={() => setReplyTo(m)}
                onTogglePin={() => togglePin(m)}
                onEdit={() => setEditingId(m.id)}
                onDelete={() => deleteMessage(m)}
                copyText={m.content}
              />
              {m.pinned && (
                <p className={`flex items-center gap-1 text-[9px] text-amber-500 mb-0.5 px-1 ${mine ? 'justify-end' : ''}`}>
                  <Pin size={9} /> закріплено
                </p>
              )}
              {!mine && (
                <p className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {m.sender_name}
                  {m.sender_type === 'client' && (
                    <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-px rounded font-bold uppercase tracking-wide">клієнт</span>
                  )}
                  {m.sender_type === 'bot' && (
                    <span className="ml-1 text-[9px] bg-violet-100 text-violet-700 px-1 py-px rounded font-bold uppercase tracking-wide">🤖 бот</span>
                  )}
                  {m.sender_type === 'admin' && ' · адмін'}
                </p>
              )}
              <div className={`flex items-center gap-0.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <div className={`min-w-0 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  mine
                    ? 'bg-gray-900 text-white rounded-br-md'
                    : m.sender_type === 'client'
                      ? 'bg-teal-50 text-gray-800 border border-teal-100 rounded-bl-md'
                      : m.sender_type === 'bot'
                        ? 'bg-violet-50 text-gray-800 border border-violet-100 rounded-bl-md'
                        : 'bg-gray-100 text-gray-800 rounded-bl-md'
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
                  {editingId === m.id ? (
                    <MessageEditBox initial={m.content} onSave={t => saveEdit(m, t)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <MessageBody content={m.content} names={mentionNames} mine={mine} />
                  )}
                  {m.file_url && (
                    <Attachment url={m.file_url} name={m.file_name ?? 'file'} mine={mine} />
                  )}
                </div>
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

      {/* Composer with mentions + attachments */}
      <MentionComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onPickFile={sendFile}
        onPickFiles={sendFiles}
        people={mentionable}
        placeholder={channel === 'team' ? 'Повідомлення команді... (@ — згадати)' : 'Повідомлення клієнту... (@ — згадати)'}
        uploading={uploading}
        accent="dark"
        onVoice={channel === 'team' ? sendFile : undefined}
      />
    </DropZone>
  )
}
