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
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}

const REC_ERRORS: Record<string, string> = {
  'not-allowed': 'Немає дозволу на мікрофон — дозволь його для сайту в налаштуваннях браузера',
  'service-not-allowed': 'Браузер заблокував розпізнавання мови — спробуй Chrome',
  'no-speech': 'Не почув голосу — натисни мікрофон і спробуй ще раз',
  'audio-capture': 'Не бачу мікрофона — перевір, чи він підключений',
  network: 'Розпізнавання недоступне (потрібен інтернет) — спробуй ще раз',
  aborted: 'Запис перервано',
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
  const errorRef = useRef('')
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Live voice meter (equalizer bars driven by the real mic level)
  const barRefs = useRef<(HTMLSpanElement | null)[]>([])
  const meterStopRef = useRef<(() => void) | null>(null)

  async function startMeter() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let raf = 0
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((s, v) => s + v, 0) / data.length / 255
        barRefs.current.forEach((el, i) => {
          if (!el) return
          const wave = Math.sin(Date.now() / 120 + i * 1.3) * 0.25 + 0.75
          el.style.height = `${Math.max(4, Math.round((6 + avg * 26 * wave) * 1.2))}px`
        })
        raf = requestAnimationFrame(tick)
      }
      tick()
      meterStopRef.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach(t => t.stop())
        ctx.close()
      }
    } catch { /* meter is best-effort — recognition still works */ }
  }

  function stopMeter() {
    meterStopRef.current?.()
    meterStopRef.current = null
  }

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

  // Fallback for browsers that block the built-in speech service (Arc,
  // Brave): record the mic and transcribe server-side with Whisper.
  async function startRecorder() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        stopMeter()
        mediaRecRef.current = null
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        if (blob.size < 2000) {
          setMessage('Не почув голосу — спробуй ще раз')
          setPhase('error')
          return
        }
        setPhase('parsing')
        try {
          const form = new FormData()
          form.append('audio', new File([blob], 'voice.webm', { type: blob.type }))
          const res = await fetch('/api/voice-command/transcribe', { method: 'POST', body: form })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Не вдалося розпізнати')
          if (!data.transcript) throw new Error('Не розчув — спробуй ще раз')
          setTranscript(data.transcript)
          parse(data.transcript)
        } catch (e) {
          setMessage((e as Error).message)
          setPhase('error')
        }
      }
      mediaRecRef.current = mr
      setPhase('listening')
      setTranscript('')
      startMeter()
      mr.start()
    } catch {
      setMessage('Немає дозволу на мікрофон — дозволь його для сайту')
      setPhase('error')
    }
  }

  function startListening() {
    setOpen(true)
    setTranscript('')
    setSummary('')
    setMessage('')
    finalRef.current = ''
    errorRef.current = ''
    // Browsers that block the speech service go straight to the recorder
    if (!supported || localStorage.getItem('gudrix:voiceMode') === 'recorder') {
      startRecorder()
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
    rec.onerror = e => { errorRef.current = e?.error ?? 'unknown' }
    rec.onend = () => {
      recRef.current = null
      stopMeter()
      const text = finalRef.current.trim()
      if (text) {
        parse(text)
        return
      }
      // The built-in service is blocked in this browser (Arc/Brave report
      // "network") — remember that and switch to the recorder fallback
      if (errorRef.current === 'network' || errorRef.current === 'service-not-allowed') {
        localStorage.setItem('gudrix:voiceMode', 'recorder')
        startRecorder()
        return
      }
      setMessage(REC_ERRORS[errorRef.current] ?? REC_ERRORS['no-speech'])
      setPhase('error')
    }
    recRef.current = rec
    setPhase('listening')
    startMeter()
    rec.start()
  }

  function stopListening() {
    recRef.current?.stop()
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') mediaRecRef.current.stop()
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
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaRecRef.current.onstop = null
      mediaRecRef.current.stop()
    }
    stopMeter()
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
              <div className="flex flex-col items-center py-3">
                {/* Pulsing mic circle */}
                <div className="relative mb-3">
                  <span className="absolute inset-0 rounded-full bg-red-400/30 animate-ping" />
                  <span className="absolute -inset-2 rounded-full bg-red-400/15 animate-pulse" />
                  <span className="relative w-14 h-14 rounded-full bg-red-500 flex items-center justify-center">
                    <Mic size={22} className="text-white" />
                  </span>
                </div>
                {/* Live equalizer bars driven by the mic level */}
                <div className="flex items-end gap-1 h-9 mb-1">
                  {[0, 1, 2, 3, 4, 5, 6].map(i => (
                    <span
                      key={i}
                      ref={el => { barRefs.current[i] = el }}
                      className="w-1.5 rounded-full bg-red-400 transition-[height] duration-75"
                      style={{ height: 5 }}
                    />
                  ))}
                </div>
                <p className="text-sm text-gray-700 text-center min-h-[20px] px-1">
                  {transcript || 'Слухаю... кажи 🎙'}
                </p>
              </div>
              <button
                onClick={stopListening}
                className="w-full flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors"
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
