'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { NotebookPen, X, Paperclip, Loader2, Send, Trash2 } from 'lucide-react'
import {
  Attachment, fileTooBig, safeStoragePath, MAX_FILE_MB,
  useChatWidth, ChatResizeHandle, DropZone,
} from '@/components/chat/shared'

// Shared per-project notepad drawer. Admin, team and client all see the same
// notes and can write text, links and attach files/images.
//
// Internal viewers (admin/team) talk to Supabase directly; the client portal
// passes `portalToken` and everything goes through the authorized API routes.

export interface NotepadViewer {
  type: 'admin' | 'team' | 'client'
  name: string
  id?: string | null
}

export interface NoteRow {
  id: string
  author_type: 'admin' | 'team' | 'client'
  author_id: string | null
  author_name: string
  content: string
  files: { url: string; name: string }[]
  created_at: string
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g

// Plain text with clickable links.
export function LinkifiedText({ content }: { content: string }) {
  const parts = content.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-teal-600 hover:text-teal-800 underline break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

const AUTHOR_BADGE: Record<NoteRow['author_type'], { label: string; cls: string }> = {
  admin: { label: 'Gudrix', cls: 'bg-gray-100 text-gray-500' },
  team: { label: 'team', cls: 'bg-blue-50 text-blue-600' },
  client: { label: 'client', cls: 'bg-amber-50 text-amber-700' },
}

export default function ProjectNotepad({ projectId, viewer, portalToken, lang = 'uk', onClose }: {
  projectId: string
  viewer: NotepadViewer
  portalToken?: string
  lang?: 'uk' | 'en'
  onClose: () => void
}) {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [portalMyId, setPortalMyId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { width, startResize } = useChatWidth()

  const t = lang === 'en'
    ? {
        title: 'Project notes',
        empty: 'No notes yet — write the first one',
        placeholder: 'Write a note... text, links, anything',
        tooBig: `File is too big — ${MAX_FILE_MB} MB max`,
        failed: 'Could not save the note',
      }
    : {
        title: 'Нотатки проєкту',
        empty: 'Ще немає нотаток — напишіть першу',
        placeholder: 'Нотатка... текст, лінки, будь-що',
        tooBig: `Файл завеликий — максимум ${MAX_FILE_MB} МБ`,
        failed: 'Не вдалося зберегти нотатку',
      }

  const load = useCallback(async () => {
    if (portalToken) {
      const res = await fetch(`/api/portal/project/${projectId}/notes`, {
        headers: { Authorization: `Bearer ${portalToken}` },
      })
      if (res.ok) {
        const { notes: rows, myId } = await res.json()
        setNotes(rows)
        if (myId) setPortalMyId(myId)
      }
      return
    }
    const { data, error: err } = await supabase
      .from('project_notes')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (err) { setError('Таблиця project_notes не знайдена — запусти project_notepad_migration.sql'); return }
    setNotes((data ?? []) as NoteRow[])
  }, [projectId, portalToken])

  useEffect(() => {
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [load])

  async function addNote() {
    const text = input.trim()
    if ((!text && !pendingFile) || busy) return
    setBusy(true)
    setError('')

    if (portalToken) {
      const form = new FormData()
      form.append('content', text)
      if (pendingFile) form.append('file', pendingFile)
      const res = await fetch(`/api/portal/project/${projectId}/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${portalToken}` },
        body: form,
      })
      setBusy(false)
      if (!res.ok) { setError(t.failed); return }
      setInput(''); setPendingFile(null)
      load()
      return
    }

    let files: { url: string; name: string }[] = []
    if (pendingFile) {
      const path = safeStoragePath(projectId, `note-${pendingFile.name}`)
      const { error: upErr } = await supabase.storage.from('chat-files').upload(path, pendingFile)
      if (upErr) { setBusy(false); setError('Не вдалося завантажити файл'); return }
      const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
      files = [{ url: pub.publicUrl, name: pendingFile.name }]
    }
    const { error: insErr } = await supabase.from('project_notes').insert({
      project_id: projectId,
      author_type: viewer.type,
      author_id: viewer.id ?? null,
      author_name: viewer.name,
      content: text,
      files,
    })
    setBusy(false)
    if (insErr) { setError(t.failed); return }
    setInput(''); setPendingFile(null)
    load()
  }

  function canDelete(n: NoteRow) {
    if (viewer.type === 'admin') return true
    const myId = viewer.id ?? portalMyId
    if (viewer.type === 'team') return n.author_type === 'team' && !!myId && n.author_id === myId
    return n.author_type === 'client' && !!myId && n.author_id === myId
  }

  async function deleteNote(n: NoteRow) {
    if (portalToken) {
      await fetch(`/api/portal/project/${projectId}/notes?noteId=${n.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${portalToken}` },
      })
    } else {
      await supabase.from('project_notes').delete().eq('id', n.id)
    }
    setNotes(prev => prev.filter(x => x.id !== n.id))
  }

  function pickFile(f: File) {
    setError('')
    if (fileTooBig(f)) { setError(t.tooBig); return }
    setPendingFile(f)
  }

  return (
    <DropZone
      onFiles={fs => { if (fs[0]) pickFile(fs[0]) }}
      className="fixed right-0 top-0 h-full max-w-[100vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width }}
    >
      <ChatResizeHandle onMouseDown={startResize} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <NotebookPen size={15} className="text-amber-500" />
          <p className="text-sm font-semibold text-gray-800">{t.title}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      {/* Composer on top — a notepad reads newest-first */}
      <div className="border-b border-gray-100 p-3 flex flex-col gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          rows={3}
          placeholder={t.placeholder}
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) pickFile(f)
            e.target.value = ''
          }}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-50 transition-colors"
            title="Attach file"
          >
            <Paperclip size={15} />
          </button>
          {pendingFile && (
            <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 rounded-lg px-2 py-1 min-w-0">
              <span className="truncate max-w-[140px]">{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} className="text-gray-300 hover:text-red-400">
                <X size={11} />
              </button>
            </span>
          )}
          <button
            onClick={addNote}
            disabled={busy || (!input.trim() && !pendingFile)}
            className="ml-auto flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl px-3.5 py-2 text-xs font-medium transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {lang === 'en' ? 'Add note' : 'Додати'}
          </button>
        </div>
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {notes.length === 0 && (
          <p className="text-xs text-gray-300 text-center mt-8 flex flex-col items-center gap-2">
            <NotebookPen size={22} className="opacity-40" />
            {t.empty}
          </p>
        )}
        {notes.map(n => {
          const badge = AUTHOR_BADGE[n.author_type]
          return (
            <div key={n.id} className="group bg-amber-50/60 border border-amber-100 rounded-xl px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-medium text-gray-700">{n.author_name}</span>
                <span className={`text-[9px] px-1.5 py-px rounded font-bold uppercase tracking-wide ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="text-[10px] text-gray-400 ml-auto">
                  {new Date(n.created_at).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                {canDelete(n) && (
                  <button
                    onClick={() => deleteNote(n)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {n.content && (
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
                  <LinkifiedText content={n.content} />
                </p>
              )}
              {(n.files ?? []).map((f, i) => (
                <Attachment key={i} url={f.url} name={f.name} mine={false} />
              ))}
            </div>
          )
        })}
      </div>
    </DropZone>
  )
}
