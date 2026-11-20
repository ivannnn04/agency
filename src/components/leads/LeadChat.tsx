'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Mic, Send, Sparkles, Square, Trash2 } from 'lucide-react'

// AI advisor pinned to the bottom of a lead's card: ask by typing or by
// voice, get advice grounded in everything stored on the lead. The
// conversation is kept per lead in this browser.

interface Msg { role: 'user' | 'assistant'; content: string }

const STARTERS = ['Що написати йому зараз?', 'Підготуй мене до наступного дзвінка', 'Що найбільше заважає закрити угоду?']
const storeKey = (id: string) => `gudrix:leadChat:${id}`

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* no clipboard access */ } }}
      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 mt-1.5"
    >
      {done ? <Check size={10} /> : <Copy size={10} />} {done ? 'Скопійовано' : 'Копіювати'}
    </button>
  )
}

export default function LeadChat({ leadId }: { leadId: string }) {
  // Mounted with key={leadId}, so each lead starts from its own saved thread
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey(leadId)) ?? '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(true)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recRef = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    abortRef.current?.abort()
    recRef.current?.stream.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, open])

  function persist(list: Msg[]) {
    try { localStorage.setItem(storeKey(leadId), JSON.stringify(list.slice(-40))) } catch { /* storage unavailable */ }
  }

  function stopTracks() {
    recRef.current?.stream.getTracks().forEach(t => t.stop())
    recRef.current = null
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || sending) return
    const history: Msg[] = [...messages, { role: 'user', content: question }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setError('')
    setOpen(true)
    setSending(true)
    const abort = new AbortController()
    abortRef.current = abort
    let answer = ''
    try {
      const res = await fetch('/api/leads/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, messages: history }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        answer += decoder.decode(value, { stream: true })
        setMessages([...history, { role: 'assistant', content: answer }])
      }
      const final: Msg[] = answer.trim() ? [...history, { role: 'assistant', content: answer.trim() }] : history
      setMessages(final)
      persist(final)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
        setMessages(history)
        persist(history)
      }
    }
    setSending(false)
  }

  // Voice → text: record, transcribe on the server, drop the text into the
  // input so it can be corrected before sending
  async function toggleMic() {
    if (recording) { recRef.current?.rec.stop(); return }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      rec.onstop = async () => {
        setRecording(false)
        stopTracks()
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1200) return
        setTranscribing(true)
        try {
          const form = new FormData()
          form.append('audio', new File([blob], 'voice.webm', { type: blob.type }))
          const res = await fetch('/api/voice-command/transcribe', { method: 'POST', body: form })
          const d = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
          const said = String(d.transcript ?? '').trim()
          if (said) setInput(prev => (prev.trim() ? `${prev.trim()} ${said}` : said))
          else setError('Нічого не розчув — спробуй ще раз')
          inputRef.current?.focus()
        } catch (e) {
          setError((e as Error).message)
        }
        setTranscribing(false)
      }
      recRef.current = { rec, stream }
      rec.start()
      setRecording(true)
    } catch {
      setError('Немає доступу до мікрофона — дозволь його в браузері')
    }
  }

  function clear() {
    abortRef.current?.abort()
    setMessages([])
    setSending(false)
    try { localStorage.removeItem(storeKey(leadId)) } catch { /* storage unavailable */ }
  }

  const hasChat = messages.length > 0

  return (
    <div className="flex-shrink-0 border-t border-gray-100 bg-white">
      {hasChat && (
        <div className="flex items-center justify-between px-5 pt-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900"><Sparkles size={12} /> AI-радник по цьому ліду</p>
          <div className="flex items-center gap-3">
            <button onClick={clear} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500"><Trash2 size={11} /> Очистити</button>
            <button onClick={() => setOpen(v => !v)} className="text-gray-400 hover:text-gray-700" title={open ? 'Згорнути' : 'Розгорнути'}>
              {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          </div>
        </div>
      )}

      {hasChat && open && (
        <div ref={listRef} className="max-h-[42vh] overflow-y-auto px-5 py-3 flex flex-col gap-2.5">
          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="self-end max-w-[85%] bg-teal-500 text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2 whitespace-pre-wrap leading-relaxed">
                {m.content}
              </div>
            ) : (
              <div key={i} className="self-start max-w-[92%] bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-2xl rounded-bl-md px-3.5 py-2 leading-relaxed">
                {m.content
                  ? <p className="whitespace-pre-wrap">{m.content}</p>
                  : <span className="flex items-center gap-1.5 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> читаю матеріали ліда…</span>}
                {m.content && !(sending && i === messages.length - 1) && <CopyText text={m.content} />}
              </div>
            )
          ))}
        </div>
      )}

      <div className="px-5 py-3">
        {!hasChat && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 mr-1"><Sparkles size={11} /> Запитай AI:</span>
            {STARTERS.map(s => (
              <button key={s} onClick={() => send(s)} className="text-[11px] text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-full px-2.5 py-1">
                {s}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-500 mb-1.5">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            rows={Math.min(5, Math.max(1, input.split('\n').length + Math.floor(input.length / 70)))}
            placeholder={recording ? 'Слухаю… натисни ще раз, щоб зупинити' : transcribing ? 'Розпізнаю…' : 'Порадься щодо цього ліда — текстом або голосом'}
            className="flex-1 text-sm text-gray-800 border border-gray-200 rounded-2xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none leading-relaxed"
          />
          <button
            onClick={toggleMic}
            disabled={transcribing}
            title={recording ? 'Зупинити запис' : 'Надиктувати голосом'}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50 ${
              recording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {transcribing ? <Loader2 size={15} className="animate-spin" /> : recording ? <Square size={13} /> : <Mic size={15} />}
          </button>
          <button
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            title="Надіслати (Enter)"
            className="w-9 h-9 rounded-full bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white flex items-center justify-center flex-shrink-0"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
