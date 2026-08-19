'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Paperclip, Loader2, CalendarDays, SmilePlus } from 'lucide-react'

// ── Resizable drawer width (shared by all chat drawers, persisted) ─────────────

const CHAT_MIN = 320
const CHAT_MAX = 720
const CHAT_DEFAULT = 380

export function useChatWidth() {
  const [width, setWidth] = useState(CHAT_DEFAULT)

  useEffect(() => {
    const saved = Number(localStorage.getItem('chatWidth'))
    if (saved >= CHAT_MIN && saved <= CHAT_MAX) setWidth(saved)
  }, [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const clamp = (x: number) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, window.innerWidth - x))
    const onMove = (ev: MouseEvent) => setWidth(clamp(ev.clientX))
    const onUp = (ev: MouseEvent) => {
      localStorage.setItem('chatWidth', String(clamp(ev.clientX)))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return { width, startResize }
}

// Invisible grab strip on the drawer's left edge.
export function ChatResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-teal-400/50 active:bg-teal-400/70 transition-colors z-10"
      title="Drag to resize"
    />
  )
}

export interface ChatPerson {
  name: string
  type: 'admin' | 'team' | 'client'
}

const MENTION_QUERY_RE = /(^|\s)@([\p{L}\w-]*)$/u

const TYPE_LABEL: Record<ChatPerson['type'], string> = {
  admin: 'admin',
  team: 'team',
  client: 'client',
}
const TYPE_BADGE: Record<ChatPerson['type'], string> = {
  admin: 'bg-gray-100 text-gray-500',
  team: 'bg-blue-50 text-blue-600',
  client: 'bg-teal-50 text-teal-600',
}

// Composer with @-mention autocomplete and a file attach button.
export function MentionComposer({
  value, onChange, onSend, onPickFile, people, placeholder, uploading, accent = 'dark', onBookMeeting,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onPickFile: (f: File) => void
  people: ChatPerson[]
  placeholder: string
  uploading: boolean
  accent?: 'dark' | 'teal'
  onBookMeeting?: () => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const match = value.match(MENTION_QUERY_RE)
  const query = match?.[2] ?? null
  const suggestions = query !== null
    ? people.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : []
  const open = suggestions.length > 0

  useEffect(() => { setActiveIdx(0) }, [query])

  function pick(name: string) {
    if (!match) return
    onChange(value.replace(MENTION_QUERY_RE, `${match[1]}@${name} `))
    taRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => (i - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[activeIdx].name); return }
      if (e.key === 'Escape') { onChange(value + ' '); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }

  const btnClass = accent === 'teal'
    ? 'bg-teal-500 hover:bg-teal-600'
    : 'bg-gray-900 hover:bg-gray-700'
  const focusClass = accent === 'teal' ? 'focus:ring-teal-400' : 'focus:ring-gray-400'

  return (
    <div className="border-t border-gray-100 p-3 flex items-end gap-2 flex-shrink-0 relative">
      {/* Mention dropdown */}
      {open && (
        <div className="absolute bottom-full left-3 mb-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto py-1">
          {suggestions.map((p, i) => (
            <button
              key={`${p.type}-${p.name}`}
              onMouseDown={e => { e.preventDefault(); pick(p.name) }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                i === activeIdx ? 'bg-gray-50' : ''
              }`}
            >
              <span className="text-gray-800 font-medium truncate">{p.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${TYPE_BADGE[p.type]}`}>
                {TYPE_LABEL[p.type]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Book meeting + attach */}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onPickFile(f)
          e.target.value = ''
        }}
      />
      <div className="flex flex-col flex-shrink-0">
        {onBookMeeting && (
          <button
            onClick={onBookMeeting}
            className="text-gray-400 hover:text-teal-600 p-2.5 rounded-xl hover:bg-teal-50 transition-colors"
            title="Book a meeting"
          >
            <CalendarDays size={16} />
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-gray-400 hover:text-gray-600 disabled:opacity-40 p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          title="Attach file"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
        </button>
      </div>

      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder={placeholder}
        className={`flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 ${focusClass} resize-none`}
      />
      <button
        onClick={onSend}
        disabled={uploading || !value.trim()}
        className={`${btnClass} disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors flex-shrink-0`}
      >
        <Send size={15} />
      </button>
    </div>
  )
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Message text with @mentions of known people highlighted.
export function MessageBody({ content, names, mine }: {
  content: string
  names: string[]
  mine: boolean
}) {
  if (!content) return null
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return <>{content}</>

  const re = new RegExp(`@(${sorted.map(escapeRe).join('|')})`, 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index))
    parts.push(
      <span key={m.index} className={`font-semibold ${mine ? 'text-teal-200' : 'text-teal-600'}`}>
        {m[0]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return <>{parts}</>
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i

// File attachment inside a message bubble: inline preview for images, chip otherwise.
export function Attachment({ url, name, mine }: {
  url: string
  name: string
  mine: boolean
}) {
  const isImage = IMAGE_RE.test(name) || IMAGE_RE.test(url)
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-w-full max-h-48 rounded-lg border border-black/5" />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium border transition-colors ${
        mine
          ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
      }`}
    >
      <Paperclip size={13} className="flex-shrink-0" />
      <span className="truncate">{name}</span>
    </a>
  )
}

export const MAX_FILE_MB = 10

export function fileTooBig(f: File) {
  return f.size > MAX_FILE_MB * 1024 * 1024
}

export function safeStoragePath(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-80)
  return `${projectId}/${crypto.randomUUID()}-${safe}`
}

// ── Emoji reactions (iOS-tapback set + the usual suspects) ─────────────────────

export interface Reaction {
  message_id: string
  emoji: string
  reactor_key: string
  reactor_name: string | null
}

export const REACTION_EMOJIS = [
  '❤️', '👍', '👎', '😂', '‼️', '❓',
  '😮', '😢', '🔥', '🎉', '👏', '🙏',
  '✅', '👀', '💪', '😍', '🤔', '😅',
  '🥳', '🫡', '🤝', '⭐', '⚡', '💯',
]

// Small hover button + emoji palette popover.
export function ReactionPicker({ onPick, mine }: {
  onPick: (emoji: string) => void
  mine: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 p-1 rounded transition-all"
        title="React"
      >
        <SmilePlus size={13} />
      </button>
      {open && (
        <div
          className={`absolute bottom-full mb-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-2 grid grid-cols-6 gap-0.5 w-56 ${
            mine ? 'right-0' : 'left-0'
          }`}
        >
          {REACTION_EMOJIS.map(e => (
            <button
              key={e}
              onClick={() => { onPick(e); setOpen(false) }}
              className="text-lg leading-none p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Reaction chips under a bubble: grouped by emoji with count; own reactions
// highlighted, click toggles.
export function ReactionChips({ reactions, myKey, onToggle, mine }: {
  reactions: Reaction[]
  myKey: string
  onToggle: (emoji: string) => void
  mine: boolean
}) {
  if (reactions.length === 0) return null
  const grouped = new Map<string, Reaction[]>()
  for (const r of reactions) {
    if (!grouped.has(r.emoji)) grouped.set(r.emoji, [])
    grouped.get(r.emoji)!.push(r)
  }
  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${mine ? 'justify-end' : ''}`}>
      {[...grouped.entries()].map(([emoji, rs]) => {
        const isMine = rs.some(r => r.reactor_key === myKey)
        const names = rs.map(r => r.reactor_name || '—').join(', ')
        return (
          <button
            key={emoji}
            onClick={() => onToggle(emoji)}
            title={names}
            className={`flex items-center gap-1 text-xs rounded-full px-1.5 py-0.5 border transition-colors ${
              isMine
                ? 'bg-teal-50 border-teal-300 text-teal-700'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <span className="text-[13px] leading-none">{emoji}</span>
            {rs.length > 1 && <span className="font-medium">{rs.length}</span>}
          </button>
        )
      })}
    </div>
  )
}
