'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lightbulb, Loader2, PhoneOff, PictureInPicture2, Send, Sparkles } from 'lucide-react'
import { UtteranceRecorder, startTicker, pickAudioMime, SegmentInfo } from '@/lib/liveAudio'

// The live sales call. Two audio streams come in from the page — the user's
// microphone and (in tab mode) the audio of the shared Meet tab — so the two
// sides are transcribed separately and never need speaker detection. Every
// new utterance may trigger a coaching request; the transcript is autosaved
// as a meeting document and summarised when the call ends.

export interface LiveRoom {
  id: string
  name: string
  language: string | null
}

type Who = 'me' | 'client' | 'room'
interface Line { id: string; t: number; who: Who; text: string }

type HintKind = 'ask' | 'objection' | 'answer' | 'value' | 'risk' | 'close'
interface Hint { id: string; kind: HintKind; say: string; why: string; at: number }

const WHO_LABEL: Record<Who, string> = { me: 'Я', client: 'Клієнт', room: 'Розмова' }

const KIND_META: Record<HintKind, { label: string; cls: string }> = {
  ask: { label: 'Запитай', cls: 'bg-blue-50 text-blue-700' },
  objection: { label: 'Заперечення', cls: 'bg-amber-50 text-amber-700' },
  answer: { label: 'Відповідь', cls: 'bg-violet-50 text-violet-700' },
  value: { label: 'Цінність', cls: 'bg-green-100 text-green-700' },
  risk: { label: 'Увага', cls: 'bg-red-50 text-red-600' },
  close: { label: 'Закривай', cls: 'bg-gray-900 text-white' },
}

const MIN_HINT_GAP_MS = 7_000   // at most one coaching request per this long
const SAVE_EVERY_MS = 10_000    // transcript autosave cadence
const TRANSCRIPT_WINDOW = 12_000 // chars of recent transcript sent for coaching
const NOW_QUESTION = 'Що мені зараз найкраще сказати або запитати? Дай одну-дві найсильніші підказки.'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const fmtLine = (l: Line) => `${WHO_LABEL[l.who]}: ${l.text}`

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function Meter({ label, level, off }: { label: string; level: number; off?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-gray-400" title={off ? 'Звук вкладки більше не надходить' : undefined}>
      {label}
      <span className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <span
          className={`block h-full rounded-full ${off ? 'bg-red-400' : 'bg-green-600'}`}
          style={{ width: off ? '100%' : `${Math.min(100, Math.round(level * 700))}%` }}
        />
      </span>
    </span>
  )
}

function HintsPanel({ hints, thinking, onNow, onAsk }: {
  hints: Hint[]
  thinking: boolean
  onNow: () => void
  onAsk: (q: string) => void
}) {
  const [q, setQ] = useState('')
  // The batch that arrived last stays bright; older ones recede
  const newestAt = hints[0]?.at ?? 0
  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Lightbulb size={15} className="text-amber-500" /> Підказки
          {thinking && <Loader2 size={13} className="animate-spin text-gray-400" />}
        </p>
        <button
          onClick={onNow}
          className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <Sparkles size={12} /> Підкажи зараз
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2.5">
        {hints.length === 0 ? (
          <p className="text-sm text-gray-300 text-center mt-10 px-6">
            Слухаю розмову. Підказка зʼявиться, коли буде що сказати — або натисни «Підкажи зараз».
          </p>
        ) : hints.map(h => (
          <div
            key={h.id}
            className={`rounded-2xl border border-gray-100 p-3.5 transition-opacity ${h.at === newestAt ? '' : 'opacity-55'}`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${KIND_META[h.kind].cls}`}>
                {KIND_META[h.kind].label}
              </span>
              {h.why && <span className="text-[11px] text-gray-400 truncate">{h.why}</span>}
            </div>
            <p className="text-[15px] font-medium text-gray-900 leading-snug">{h.say}</p>
          </div>
        ))}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          if (!q.trim()) return
          onAsk(q.trim())
          setQ('')
        }}
        className="flex items-center gap-2 p-3 border-t border-gray-100 flex-shrink-0"
      >
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Запитай AI… напр. «як відповісти про ціну?»"
          className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
        />
        <button type="submit" disabled={!q.trim()} className="bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors">
          <Send size={14} />
        </button>
      </form>
    </div>
  )
}

interface DocumentPiP {
  requestWindow: (opts: { width: number; height: number }) => Promise<Window>
}

export default function LiveCall({ room, mode, mic, display, onDone }: {
  room: LiveRoom
  mode: 'tab' | 'mic'
  mic: MediaStream
  display: MediaStream | null
  onDone: (meetingDocId: string | null) => void
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState({ me: 0, client: 0 })
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState('')
  const [ending, setEnding] = useState<'' | 'saving' | 'summary'>('')
  const [clientLost, setClientLost] = useState(false)
  const [pipWin, setPipWin] = useState<Window | null>(null)

  const linesRef = useRef<Line[]>([])
  const hintsRef = useRef<Hint[]>([])
  const memoryRef = useRef('')
  const docIdRef = useRef<string | null>(null)
  const docReadyRef = useRef<Promise<void> | null>(null)
  const aliveRef = useRef(true)
  const endingRef = useRef(false)
  const pendingSttRef = useRef(0)
  const dirtyRef = useRef(false)
  const lastSaveRef = useRef(0)
  const savingRef = useRef(false)
  const hintBusyRef = useRef(false)
  const hintDueRef = useRef<number | null>(null)
  const lastHintAtRef = useRef(0)
  const hintedLinesRef = useRef(0)
  const questionRef = useRef<string | null>(null)
  const recordersRef = useRef<UtteranceRecorder[]>([])
  const pipRef = useRef<Window | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const hasClient = mode === 'tab' && (display?.getAudioTracks().length ?? 0) > 0
  const canPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window

  const fullTranscript = () => linesRef.current.map(fmtLine).join('\n')

  function recentTranscript() {
    const out: string[] = []
    let size = 0
    for (let i = linesRef.current.length - 1; i >= 0; i--) {
      const s = fmtLine(linesRef.current[i])
      if (size + s.length > TRANSCRIPT_WINDOW && out.length > 0) break
      out.unshift(s)
      size += s.length + 1
    }
    return out.join('\n')
  }

  // Ask for coaching soon: right away for a direct question, otherwise no
  // more often than MIN_HINT_GAP_MS. The worker tick fires it.
  function requestHint(immediately = false) {
    const at = immediately
      ? Date.now()
      : Math.max(Date.now() + 600, lastHintAtRef.current + MIN_HINT_GAP_MS)
    hintDueRef.current = hintDueRef.current === null ? at : Math.min(hintDueRef.current, at)
  }

  function addLine(line: Line) {
    const next = [...linesRef.current, line].sort((a, b) => a.t - b.t)
    linesRef.current = next
    setLines(next)
    dirtyRef.current = true
    requestHint()
  }

  async function onSegment(who: Who, blob: Blob, info: SegmentInfo) {
    // On loudspeakers the mic re-hears the client; the tab stream already has it
    if (who === 'me' && info.overlapRatio > 0.8) return
    pendingSttRef.current++
    try {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('audio', new File([blob], `segment.${ext}`, { type: blob.type }))
      form.append('lang', room.language || 'auto')
      form.append('hint', room.name)
      const res = await fetch('/api/sales-ai/transcribe', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const text = String(data.text ?? '').trim()
      if (!aliveRef.current) return
      if (text) addLine({ id: `${info.startedAt}-${who}`, t: info.startedAt, who, text })
      setNotice(n => (n.startsWith('Транскрипція') ? '' : n))
    } catch (e) {
      if (aliveRef.current) setNotice(`Транскрипція: ${(e as Error).message}`)
    } finally {
      pendingSttRef.current--
    }
  }

  async function runHint() {
    const question = questionRef.current
    questionRef.current = null
    if (!question && linesRef.current.length === hintedLinesRef.current) return
    hintBusyRef.current = true
    lastHintAtRef.current = Date.now()
    hintedLinesRef.current = linesRef.current.length
    setThinking(true)
    try {
      const res = await fetch('/api/sales-ai/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: room.id,
          meetingDocId: docIdRef.current,
          transcript: recentTranscript(),
          memory: memoryRef.current,
          shown: hintsRef.current.slice(0, 8).map(h => h.say),
          question,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!aliveRef.current) return
      if (typeof data.memory === 'string') memoryRef.current = data.memory
      if (Array.isArray(data.hints) && data.hints.length > 0) {
        const at = Date.now()
        const fresh: Hint[] = data.hints.map((h: Omit<Hint, 'id' | 'at'>, i: number) => ({ ...h, id: `${at}-${i}`, at }))
        hintsRef.current = [...fresh, ...hintsRef.current].slice(0, 40)
        setHints(hintsRef.current)
      }
      setNotice(n => (n.startsWith('Підказки') ? '' : n))
    } catch (e) {
      if (aliveRef.current) setNotice(`Підказки: ${(e as Error).message}`)
    } finally {
      hintBusyRef.current = false
      if (aliveRef.current) setThinking(false)
    }
  }

  function ask(question: string) {
    questionRef.current = question
    requestHint(true)
  }

  async function saveTranscript() {
    if (!docIdRef.current) return
    savingRef.current = true
    dirtyRef.current = false
    lastSaveRef.current = Date.now()
    try {
      const res = await fetch('/api/sales-ai/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docIdRef.current, content: fullTranscript() }),
      })
      if (!res.ok) dirtyRef.current = true
    } catch {
      dirtyRef.current = true
    } finally {
      savingRef.current = false
    }
  }

  useEffect(() => {
    aliveRef.current = true
    const startedAt = Date.now()
    lastSaveRef.current = startedAt

    const ctx = new AudioContext()
    ctx.resume().catch(() => {})
    const mime = pickAudioMime()
    const make = (stream: MediaStream, who: Who, threshold: number, otherActive?: () => boolean) => {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      return new UtteranceRecorder(stream, analyser, {
        threshold,
        mimeType: mime,
        otherActive,
        onSegment: (blob, info) => { onSegment(who, blob, info) },
      })
    }

    const tabTracks = mode === 'tab' ? display?.getAudioTracks() ?? [] : []
    const onTabEnded = () => {
      setClientLost(true)
      setNotice('Звук вкладки більше не надходить (спільний доступ зупинено) — далі чую лише твій мікрофон')
    }
    let clientRec: UtteranceRecorder | null = null
    if (tabTracks.length > 0) {
      // Tab audio is clean digital signal → lower threshold than a room mic
      clientRec = make(new MediaStream(tabTracks), 'client', 0.006)
      tabTracks[0].addEventListener('ended', onTabEnded)
    }
    const other = clientRec
    const meRec = make(
      new MediaStream(mic.getAudioTracks()),
      other ? 'me' : 'room',
      0.012,
      other ? () => other.speaking : undefined,
    )
    const recs = other ? [meRec, other] : [meRec]
    recordersRef.current = recs
    recs.forEach(r => r.start())

    // The meeting document exists from the first second, so a closed tab
    // loses at most the last autosave interval
    docReadyRef.current ??= (async () => {
      try {
        const title = `Зустріч ${new Date().toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
        const res = await fetch('/api/sales-ai/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id: room.id, kind: 'meeting', title, content: '' }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        docIdRef.current = data.doc.id
      } catch (e) {
        if (aliveRef.current) setNotice(`Зустріч не зберігається: ${(e as Error).message}`)
      }
    })()

    // One worker-driven loop runs the VAD, the meters, hint scheduling and
    // autosave — page timers are throttled while the user is on the Meet tab
    let lastUi = 0
    const stopTicker = startTicker(() => {
      const now = Date.now()
      recs.forEach(r => r.tick(now))
      if (now - lastUi >= 250) {
        lastUi = now
        setLevels({ me: meRec.level, client: other?.level ?? 0 })
        setElapsed(Math.floor((now - startedAt) / 1000))
      }
      if (endingRef.current) return
      if (hintDueRef.current !== null && now >= hintDueRef.current && !hintBusyRef.current) {
        hintDueRef.current = null
        runHint()
      }
      if (dirtyRef.current && !savingRef.current && now - lastSaveRef.current >= SAVE_EVERY_MS) {
        saveTranscript()
      }
    })

    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)

    return () => {
      aliveRef.current = false
      stopTicker()
      recs.forEach(r => r.stop())
      tabTracks[0]?.removeEventListener('ended', onTabEnded)
      ctx.close().catch(() => {})
      window.removeEventListener('beforeunload', warn)
      pipRef.current?.close()
    }
    // Streams and room are fixed for the lifetime of a call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  async function end() {
    if (endingRef.current) return
    endingRef.current = true
    setEnding('saving')
    hintDueRef.current = null

    // Flush whatever is being said, then let those last segments transcribe
    recordersRef.current.forEach(r => r.stop())
    await sleep(400)
    const t0 = Date.now()
    while (pendingSttRef.current > 0 && Date.now() - t0 < 8000) await sleep(150)

    await docReadyRef.current
    const docId = docIdRef.current
    const transcript = fullTranscript()
    if (!docId) { onDone(null); return }

    if (!transcript.trim()) {
      await fetch('/api/sales-ai/docs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId }),
      }).catch(() => {})
      onDone(null)
      return
    }

    await fetch('/api/sales-ai/docs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: docId, content: transcript }),
    }).catch(() => {})

    setEnding('summary')
    await fetch('/api/sales-ai/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, docId, transcript }),
    }).catch(() => {})
    onDone(docId)
  }

  // Always-on-top window with the hints, so they stay visible over Meet
  async function openPip() {
    const dpip = (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture
    if (!dpip) return
    try {
      const w = await dpip.requestWindow({ width: 380, height: 620 })
      const base = w.document.createElement('base')
      base.href = `${window.location.origin}/`
      w.document.head.appendChild(base)
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const style = w.document.createElement('style')
          style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n')
          w.document.head.appendChild(style)
        } catch {
          if (sheet.href) {
            const link = w.document.createElement('link')
            link.rel = 'stylesheet'
            link.href = sheet.href
            w.document.head.appendChild(link)
          }
        }
      }
      w.document.documentElement.className = document.documentElement.className
      w.document.body.className = document.body.className
      w.document.body.style.margin = '0'
      w.document.title = `Sales AI · ${room.name}`
      w.addEventListener('pagehide', () => {
        pipRef.current = null
        setPipWin(null)
      })
      pipRef.current = w
      setPipWin(w)
    } catch { /* the user dismissed the window request */ }
  }

  const panel = (
    <HintsPanel hints={hints} thinking={thinking} onNow={() => ask(NOW_QUESTION)} onAsk={ask} />
  )

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* Top bar */}
      <div className="flex items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-gray-100 flex-wrap flex-shrink-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-red-500">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          LIVE · {fmtClock(elapsed)}
        </span>
        <span className="text-sm font-medium text-gray-900 truncate max-w-[40vw]">{room.name}</span>
        <Meter label={hasClient ? 'Я' : 'Мікрофон'} level={levels.me} />
        {hasClient && <Meter label="Клієнт" level={levels.client} off={clientLost} />}
        <div className="ml-auto flex items-center gap-2">
          {canPip && !pipWin && (
            <button
              onClick={openPip}
              className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:border-gray-300 text-gray-700 px-3 py-2 rounded-xl transition-colors"
              title="Плаваюче вікно з підказками поверх Google Meet"
            >
              <PictureInPicture2 size={13} /> Поверх вікон
            </button>
          )}
          <button
            onClick={end}
            disabled={!!ending}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition-colors"
          >
            <PhoneOff size={13} /> Завершити
          </button>
        </div>
      </div>

      {notice && (
        <p className="px-5 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100 flex-shrink-0">{notice}</p>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
        {/* Transcript */}
        <div className="min-h-0 overflow-y-auto p-5 border-b md:border-b-0 md:border-r border-gray-100 flex flex-col gap-2">
          {lines.length === 0 && (
            <p className="text-sm text-gray-300 text-center mt-10">Транскрипт зʼявиться, щойно хтось заговорить…</p>
          )}
          {lines.map(l => (
            <div key={l.id} className={`max-w-[88%] ${l.who === 'me' ? 'self-end' : 'self-start'}`}>
              <p className={`text-[10px] text-gray-400 mb-0.5 px-1 ${l.who === 'me' ? 'text-right' : ''}`}>{WHO_LABEL[l.who]}</p>
              <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                l.who === 'me' ? 'bg-gray-900 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                {l.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Hints */}
        <div className="min-h-0">
          {pipWin ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <PictureInPicture2 size={28} className="text-gray-300" />
              <p className="text-sm text-gray-400">Підказки відкрито в плаваючому вікні поверх інших вікон</p>
              <button onClick={() => pipRef.current?.close()} className="text-xs text-gray-500 hover:text-gray-800 underline">
                Повернути сюди
              </button>
            </div>
          ) : panel}
        </div>
      </div>

      {pipWin && createPortal(<div className="h-screen bg-white text-gray-900">{panel}</div>, pipWin.document.body)}

      {ending && (
        <div className="absolute inset-0 z-10 bg-white/90 flex flex-col items-center justify-center gap-3">
          <Loader2 size={24} className="animate-spin text-gray-400" />
          <p className="text-sm font-medium text-gray-700">
            {ending === 'saving' ? 'Зберігаю транскрипт…' : 'Готую підсумок зустрічі та follow-up…'}
          </p>
        </div>
      )}
    </div>
  )
}
