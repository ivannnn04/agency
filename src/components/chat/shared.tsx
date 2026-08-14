'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Loader2 } from 'lucide-react'

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
  value, onChange, onSend, onPickFile, people, placeholder, uploading, accent = 'dark',
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onPickFile: (f: File) => void
  people: ChatPerson[]
  placeholder: string
  uploading: boolean
  accent?: 'dark' | 'teal'
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

      {/* Attach */}
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
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="text-gray-400 hover:text-gray-600 disabled:opacity-40 p-2.5 rounded-xl hover:bg-gray-50 transition-colors flex-shrink-0"
        title="Attach file"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>

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
