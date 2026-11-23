'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Paperclip, Send, X } from 'lucide-react'

// Admin: send a project note (a document) to the client for review.
// Shows the letter exactly as the client will get it before anything is sent;
// the letter text can be rewritten and the preview follows.

interface Preview {
  subject: string
  html: string
  defaultLetter: string
  recipients: { email: string; name: string | null; lang: 'en' | 'uk' }[]
  files: { name: string; size: number | null; attached: boolean }[]
}
export interface ReviewSent { at: string; to: string[] }

const size = (b: number | null) => !b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

export default function NoteReviewDialog({ noteId, onClose, onSent }: {
  noteId: string
  onClose: () => void
  onSent: (info: ReviewSent) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [message, setMessage] = useState<string | null>(null)   // null until the default letter arrives
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ sent: number; failed: number; attached: number; chat: boolean; to: string[] } | null>(null)
  const seq = useRef(0)
  const skipNext = useRef(false)   // the default letter arriving is not an edit

  // Load the preview, and refresh it shortly after the letter text changes
  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return }
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      setRefreshing(true)
      const res = await fetch('/api/projects/note-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, action: 'preview', message: message ?? undefined }),
      }).catch(() => null)
      const d = res ? await res.json().catch(() => ({})) : {}
      if (mine !== seq.current) return
      setRefreshing(false)
      if (!res?.ok) { setError(d.error ?? 'Не вдалося підготувати лист'); return }
      setError('')
      setPreview(d)
      if (message === null) { skipNext.current = true; setMessage(d.defaultLetter) }
    }, message === null ? 0 : 500)
    return () => clearTimeout(timer)
  }, [noteId, message])

  async function send() {
    if (sending || !preview) return
    setSending(true); setError('')
    const res = await fetch('/api/projects/note-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, action: 'send', message: message ?? undefined }),
    }).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setSending(false)
    if (!res?.ok) { setError(d.error ?? 'Не вдалося надіслати лист'); return }
    setDone(d)
    onSent({ at: d.at, to: d.to })
  }

  const noClients = !!preview && preview.recipients.length === 0
  const label = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400'

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden ${done ? '' : 'md:h-[92vh]'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-900">Надіслати клієнту на рев’ю</p>
            <p className="text-xs text-gray-400">Клієнт отримає лист із файлом у вкладенні та повідомлення в чаті платформи</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
        </div>

        {done ? (
          <div className="p-10 flex flex-col items-center text-center gap-2">
            <CheckCircle2 size={36} className="text-emerald-500" />
            <p className="text-base font-semibold text-gray-900">Надіслано</p>
            <p className="text-sm text-gray-600">{done.to.join(', ')}</p>
            <p className="text-xs text-gray-400">
              {done.attached > 0 ? `Файлів у вкладенні: ${done.attached}` : 'Без вкладень — у листі є посилання на файл'}
              {done.chat ? ' · повідомлення в чаті клієнта додано' : ' · повідомлення в чат не додалося'}
              {done.failed > 0 ? ` · не доставлено: ${done.failed}` : ''}
            </p>
            <button onClick={onClose} className="mt-4 bg-gray-900 hover:bg-gray-700 text-white rounded-xl px-5 py-2 text-sm font-medium">Готово</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid md:grid-cols-[360px_1fr]">
            {/* Left: who, what text, what files */}
            <div className="p-5 flex flex-col gap-4 overflow-y-auto border-b md:border-b-0 md:border-r border-gray-100">
              <div>
                <p className={label}>Кому</p>
                {!preview ? <p className="text-sm text-gray-300 mt-1">…</p> : noClients ? (
                  <p className="text-sm text-red-600 mt-1">У проєкті немає клієнтів з емейлом. Додай їх у розділі «Клієнти».</p>
                ) : (
                  <div className="flex flex-col gap-0.5 mt-1">
                    {preview.recipients.map(r => (
                      <p key={r.email} className="text-sm text-gray-800">
                        {r.name ? `${r.name} · ` : ''}<span className="text-gray-500">{r.email}</span>
                        <span className="ml-1.5 text-[10px] font-bold uppercase text-gray-300">{r.lang}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col flex-1 min-h-[220px]">
                <div className="flex items-center justify-between">
                  <p className={label}>Текст листа</p>
                  {preview && message !== null && message.trim() !== preview.defaultLetter.trim() && (
                    <button onClick={() => setMessage(preview.defaultLetter)} className="text-[11px] text-gray-400 hover:text-gray-700 underline">повернути стандартний</button>
                  )}
                </div>
                <textarea
                  value={message ?? ''}
                  onChange={e => setMessage(e.target.value)}
                  disabled={message === null}
                  className="mt-1 flex-1 w-full text-sm leading-relaxed border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                />
                {preview && preview.recipients.length > 1 && message !== null && message.trim() === preview.defaultLetter.trim() && (
                  <p className="text-[11px] text-gray-400 mt-1">Поки текст стандартний, кожен клієнт отримає його своєю мовою і зі своїм іменем.</p>
                )}
              </div>

              <div>
                <p className={label}>Файли</p>
                {preview && preview.files.length === 0 && <p className="text-sm text-gray-400 mt-1">У нотатці немає файлу — піде лише текст.</p>}
                <div className="flex flex-col gap-1 mt-1">
                  {(preview?.files ?? []).map(f => (
                    <div key={f.name} className="flex items-center gap-2 text-sm text-gray-800">
                      <Paperclip size={13} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{size(f.size)}</span>
                      <span className={`text-[10px] font-semibold flex-shrink-0 ${f.attached ? 'text-emerald-600' : 'text-amber-600'}`}>{f.attached ? 'вкладення' : 'посилання'}</span>
                    </div>
                  ))}
                </div>
                {preview?.files.some(f => !f.attached) && (
                  <p className="text-[11px] text-amber-600 mt-1">Файли завеликі для пошти (понад 18 МБ разом) — у листі буде кнопка завантаження.</p>
                )}
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2">Скасувати</button>
                <button onClick={send} disabled={sending || !preview || noClients || refreshing || !(message ?? '').trim()}
                  className="ml-auto flex items-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Надіслати клієнту
                </button>
              </div>
            </div>

            {/* Right: the letter as it will arrive */}
            <div className="flex flex-col min-h-0 bg-gray-50">
              <div className="px-5 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2 flex-shrink-0">
                <span className={label}>Тема</span>
                <span className="text-sm text-gray-800 truncate flex-1">{preview?.subject ?? '…'}</span>
                {refreshing && <Loader2 size={13} className="animate-spin text-gray-300 flex-shrink-0" />}
              </div>
              {preview
                ? <iframe title="Прев’ю листа" sandbox="" srcDoc={preview.html} className="flex-1 w-full min-h-[420px] bg-white" />
                : <div className="flex-1 min-h-[420px] flex items-center justify-center text-gray-300"><Loader2 size={20} className="animate-spin" /></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
