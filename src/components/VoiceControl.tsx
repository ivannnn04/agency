'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react'

// Voice control for the admin header: hold a conversation-free loop of
// speak → parse (Claude) → confirm → execute. Recognition runs in the
// browser (Web Speech API, uk-UA); nothing is executed without the
// confirmation click.

type Phase = 'idle' | 'listening' | 'parsing' | 'confirm' | 'executing' | 'done' | 'error'

// Minimal typing for the vendor-prefixed Web Speech API
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

export default function VoiceControl() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [summary, setSummary] = useState('')
  const [message, setMessage] = useState('')
  const actionRef = useRef<unknown>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const parse = useCallback(async (text: string) => {
    if (!text.trim()) { setPhase('idle'); return }
    setPhase('parsing')
    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Щось пішло не так')
      if (data.unknown) {
        setMessage(data.reason ?? 'Не зрозумів — спробуй переформулювати')
        setPhase('error')
        return
      }
      actionRef.current = data.action
      setSummary(data.summary)
      setPhase('confirm')
    } catch (e) {
      setMessage((e as Error).message)
      setPhase('error')
    }
  }, [])

  function startListening() {
    setOpen(true)
    setTranscript('')
    setSummary('')
    setMessage('')
    finalRef.current = ''
    if (!supported) {
      setMessage('Браузер не підтримує розпізнавання мови — спробуй Chrome або Safari')
      setPhase('error')
      return
    }
    const Ctor = (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition
      ?? (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition
    const rec = new Ctor()
    rec.lang = 'uk-UA'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = e => {
      let interim = ''
      let final = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      finalRef.current = final
      setTranscript((final + ' ' + interim).trim())
    }
    rec.onend = () => {
      recRef.current = null
      const text = finalRef.current.trim()
      setPhase(p => (p === 'listening' ? 'parsing' : p))
      if (text) parse(text)
      else setPhase(p => (p === 'parsing' ? 'idle' : p))
    }
    rec.onerror = () => { /* onend fires next */ }
    recRef.current = rec
    setPhase('listening')
    rec.start()
  }

  function stopListening() {
    recRef.current?.stop()
  }

  async function execute() {
    setPhase('executing')
    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Не вдалося виконати')
      setMessage(data.done ?? 'Готово')
      setPhase('done')
      setTimeout(() => { setOpen(false); setPhase('idle'); window.location.reload() }, 1200)
    } catch (e) {
      setMessage((e as Error).message)
      setPhase('error')
    }
  }

  function close() {
    recRef.current?.stop()
    setOpen(false)
    setPhase('idle')
  }

  return (
    <>
      <button
        onClick={() => (phase === 'listening' ? stopListening() : startListening())}
        className={`relative p-1 transition-colors ${
          phase === 'listening' ? 'text-red-400' : 'text-gray-400 hover:text-white'
        }`}
        title="Голосова команда"
      >
        <Mic size={18} className={phase === 'listening' ? 'animate-pulse' : ''} />
      </button>

      {open && (
        <div className="fixed top-16 right-4 z-[90] w-[min(92vw,380px)] bg-white rounded-2xl border border-gray-200 shadow-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-900 uppercase tracking-wide flex items-center gap-1.5">
              <Mic size={12} className={phase === 'listening' ? 'text-red-500 animate-pulse' : 'text-gray-400'} />
              Голосова команда
            </p>
            <button onClick={close} className="text-gray-300 hover:text-gray-600 p-1"><X size={14} /></button>
          </div>

          {phase === 'listening' && (
            <>
              <p className="text-sm text-gray-700 min-h-[40px]">{transcript || 'Слухаю... кажи 🎙'}</p>
              <button
                onClick={stopListening}
                className="mt-2 flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition-colors"
              >
                <Square size={11} fill="currentColor" /> Стоп — розпізнати
              </button>
            </>
          )}

          {phase === 'parsing' && (
            <p className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 size={14} className="animate-spin" /> Розбираю команду...
            </p>
          )}

          {phase === 'confirm' && (
            <>
              <p className="text-[11px] text-gray-400 mb-1">«{transcript}»</p>
              <p className="text-sm font-medium text-gray-900 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">{summary}</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={execute}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white py-2 rounded-xl text-sm font-medium transition-colors"
                >
                  <Check size={14} /> Виконати
                </button>
                <button
                  onClick={startListening}
                  className="p-2 text-gray-400 hover:text-gray-700 border border-gray-200 rounded-xl transition-colors"
                  title="Сказати ще раз"
                >
                  <RotateCcw size={14} />
                </button>
                <button onClick={close} className="px-3 text-sm text-gray-400 hover:text-gray-600">Ні</button>
              </div>
            </>
          )}

          {phase === 'executing' && (
            <p className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 size={14} className="animate-spin" /> Виконую...
            </p>
          )}

          {phase === 'done' && (
            <p className="flex items-center gap-2 text-sm text-teal-700 py-2">
              <Check size={15} /> {message}
            </p>
          )}

          {phase === 'error' && (
            <>
              <p className="text-sm text-red-500 py-1">{message}</p>
              <button
                onClick={startListening}
                className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
              >
                <RotateCcw size={12} /> Спробувати ще раз
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
