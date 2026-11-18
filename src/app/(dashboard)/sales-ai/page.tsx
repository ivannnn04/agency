'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Captions, ChevronDown, ChevronRight, FileText, Headset, Loader2, Mic, MonitorUp,
  Plus, Trash2, Upload, X,
} from 'lucide-react'
import LiveCall from '@/components/sales/LiveCall'

// Sales AI: one "room" per client/deal. Before a call the room collects
// context (brief, linked lead/project, previous meeting transcripts); during
// a call LiveCall listens to both sides and coaches in real time; after it
// the transcript + debrief are stored here and feed the next call.

interface Room {
  id: string
  name: string
  about: string | null
  language: string | null
  lead_id: string | null
  project_id: string | null
  created_at: string
}
interface Doc {
  id: string
  room_id: string
  kind: 'doc' | 'meeting'
  title: string
  content: string | null
  summary: string | null
  created_at: string
}
interface Option { id: string; name: string }
interface LiveState { mode: 'tab' | 'mic'; mic: MediaStream; display: MediaStream | null }

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data as T
}

// .vtt/.srt exports: keep the words, drop cue numbers and timestamps
function stripSubtitleMarkup(text: string) {
  return text
    .split(/\r?\n/)
    .filter(l => {
      const s = l.trim()
      if (!s || s === 'WEBVTT' || /^\d+$/.test(s)) return false
      return !/^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->/.test(s)
    })
    .join('\n')
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })

export default function SalesAiPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [leads, setLeads] = useState<Option[]>([])
  const [projects, setProjects] = useState<Option[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', content: '' })
  const [savingDoc, setSavingDoc] = useState(false)
  const [live, setLive] = useState<LiveState | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const liveRef = useRef<LiveState | null>(null)

  const room = rooms.find(r => r.id === activeId) ?? null
  const canShareTab = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api<{ rooms: Room[]; leads: Option[]; projects: Option[] }>('/api/sales-ai/rooms')
        setRooms(data.rooms)
        setLeads(data.leads)
        setProjects(data.projects)
        if (data.rooms.length > 0 && window.matchMedia('(min-width: 768px)').matches) setActiveId(data.rooms[0].id)
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    })()
  }, [])

  const loadDocs = useCallback(async (roomId: string) => {
    try {
      const data = await api<{ docs: Doc[] }>(`/api/sales-ai/docs?room=${roomId}`)
      setDocs(data.docs)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    setDocs([])
    setOpenDoc(null)
    setAdding(false)
    setStartError('')
    if (activeId) loadDocs(activeId)
  }, [activeId, loadDocs])

  // Leaving the page mid-call must release the mic and the tab capture
  useEffect(() => () => {
    liveRef.current?.mic.getTracks().forEach(t => t.stop())
    liveRef.current?.display?.getTracks().forEach(t => t.stop())
  }, [])

  async function createRoom() {
    try {
      const data = await api<{ room: Room }>('/api/sales-ai/rooms', 'POST', { name: 'Новий клієнт' })
      setRooms(prev => [data.room, ...prev])
      setActiveId(data.room.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function editRoom(patch: Partial<Room>) {
    if (!room) return
    setRooms(prev => prev.map(r => (r.id === room.id ? { ...r, ...patch } : r)))
  }

  async function saveRoom(patch: Partial<Room>) {
    if (!room) return
    editRoom(patch)
    try {
      await api('/api/sales-ai/rooms', 'PATCH', { id: room.id, ...patch })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteRoom() {
    if (!room) return
    if (!window.confirm(`Видалити «${room.name}» разом з усіма транскриптами та матеріалами?`)) return
    try {
      await api('/api/sales-ai/rooms', 'DELETE', { id: room.id })
      setRooms(prev => prev.filter(r => r.id !== room.id))
      setActiveId(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function addDoc() {
    if (!room || !draft.content.trim() || savingDoc) return
    setSavingDoc(true)
    try {
      const data = await api<{ doc: Doc }>('/api/sales-ai/docs', 'POST', {
        room_id: room.id,
        kind: 'doc',
        title: draft.title.trim() || 'Матеріал',
        content: draft.content.trim(),
      })
      setDocs(prev => [data.doc, ...prev])
      setDraft({ title: '', content: '' })
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    }
    setSavingDoc(false)
  }

  async function deleteDoc(d: Doc) {
    if (!window.confirm(`Видалити «${d.title}»? Асистент більше не знатиме цього.`)) return
    setDocs(prev => prev.filter(x => x.id !== d.id))
    try {
      await api('/api/sales-ai/docs', 'DELETE', { id: d.id })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function onPickFile(f: File | null) {
    if (!f) return
    const raw = await f.text()
    const content = /\.(vtt|srt)$/i.test(f.name) ? stripSubtitleMarkup(raw) : raw
    setDraft({ title: f.name.replace(/\.[^.]+$/, ''), content })
    setAdding(true)
  }

  // Streams are requested right here in the click handler: the browser only
  // shows the tab picker in response to a user gesture.
  async function startLive(mode: 'tab' | 'mic') {
    if (starting) return
    setStarting(true)
    setStartError('')
    let display: MediaStream | null = null
    try {
      if (mode === 'tab') {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 1 },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          selfBrowserSurface: 'exclude',
          systemAudio: 'include',
        } as DisplayMediaStreamOptions)
        if (display.getAudioTracks().length === 0) {
          throw new Error('Звук не передано. Обери саме вкладку з дзвінком і увімкни «Also share tab audio» (Поділитися звуком вкладки).')
        }
      }
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const state: LiveState = { mode, mic, display }
      liveRef.current = state
      setLive(state)
    } catch (e) {
      display?.getTracks().forEach(t => t.stop())
      const err = e as Error
      setStartError(
        err.name === 'NotAllowedError'
          ? 'Доступ не надано — дозволь мікрофон і вибери вкладку з дзвінком'
          : err.message,
      )
    }
    setStarting(false)
  }

  function endLive(meetingDocId: string | null) {
    liveRef.current?.mic.getTracks().forEach(t => t.stop())
    liveRef.current?.display?.getTracks().forEach(t => t.stop())
    liveRef.current = null
    setLive(null)
    if (activeId) loadDocs(activeId).then(() => setOpenDoc(meetingDocId))
  }

  if (live && room) {
    return <LiveCall room={room} mode={live.mode} mic={live.mic} display={live.display} onDone={endLive} />
  }

  const field = 'border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400'

  return (
    <div className="flex h-full">
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.vtt,.srt,.csv,text/plain"
        className="hidden"
        onChange={e => { onPickFile(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      {/* Rooms */}
      <aside className={`w-full md:w-64 border-r border-gray-100 bg-white flex-col flex-shrink-0 ${activeId ? 'hidden md:flex' : 'flex'}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><Headset size={15} /> Sales AI</p>
          <button
            onClick={createRoom}
            className="bg-gray-900 hover:bg-gray-700 text-white p-1.5 rounded-lg transition-colors"
            title="Новий клієнт"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="text-xs text-gray-300 p-3">Завантаження...</p>
          ) : rooms.length === 0 ? (
            <p className="text-xs text-gray-300 p-3">Створи кімнату для клієнта, з яким готуєшся до дзвінка</p>
          ) : rooms.map(r => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                r.id === activeId ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
            >
              <p className={`text-sm truncate ${r.id === activeId ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{r.name}</p>
              <p className="text-[11px] text-gray-400">{fmtDate(r.created_at)}</p>
            </button>
          ))}
        </div>
      </aside>

      {/* Room */}
      <div className={`flex-1 min-w-0 overflow-y-auto bg-white ${activeId ? 'block' : 'hidden md:block'}`}>
        {error && (
          <div className="m-4 flex items-start justify-between gap-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-300 hover:text-red-500 flex-shrink-0"><X size={14} /></button>
          </div>
        )}

        {!room ? (
          !loading && (
            <div className="h-full min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-6">
              <Headset size={40} className="text-gray-200" />
              <p className="text-sm text-gray-400 max-w-sm">
                AI-асистент, який знає всі попередні зустрічі з клієнтом, слухає дзвінок і підказує, що сказати.
              </p>
              <button
                onClick={createRoom}
                className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                <Plus size={14} /> Новий клієнт
              </button>
            </div>
          )
        ) : (
          <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 flex flex-col gap-6">
            <div>
              <button onClick={() => setActiveId(null)} className="md:hidden flex items-center gap-1 text-xs text-gray-400 mb-3">
                <ArrowLeft size={13} /> Усі клієнти
              </button>
              <input
                value={room.name}
                onChange={e => editRoom({ name: e.target.value })}
                onBlur={e => saveRoom({ name: e.target.value })}
                placeholder="Імʼя клієнта або назва угоди"
                className="w-full text-2xl font-bold text-gray-900 placeholder-gray-200 focus:outline-none bg-transparent"
              />
            </div>

            {/* Links + language */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-gray-400">
                Лід із CRM
                <select value={room.lead_id ?? ''} onChange={e => saveRoom({ lead_id: e.target.value || null })} className={field}>
                  <option value="">— не привʼязано —</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-gray-400">
                Проєкт
                <select value={room.project_id ?? ''} onChange={e => saveRoom({ project_id: e.target.value || null })} className={field}>
                  <option value="">— не привʼязано —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-gray-400">
                Мова дзвінка
                <select value={room.language ?? 'auto'} onChange={e => saveRoom({ language: e.target.value })} className={field}>
                  <option value="auto">Авто</option>
                  <option value="en">English</option>
                  <option value="uk">Українська</option>
                </select>
              </label>
            </div>

            {/* Brief */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-gray-900">Бриф для асистента</span>
              <textarea
                value={room.about ?? ''}
                onChange={e => editRoom({ about: e.target.value })}
                onBlur={e => saveRoom({ about: e.target.value })}
                rows={4}
                placeholder="Хто клієнт, що продаємо, ціна і на що готовий піти, чого хочеш досягти на цьому дзвінку, на що звернути увагу…"
                className={`${field} resize-y leading-relaxed`}
              />
            </label>

            {/* Start */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
              <p className="text-sm font-semibold text-gray-900 mb-1">Лайв-дзвінок</p>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">
                Відкрий Google Meet у сусідній вкладці цього ж браузера, натисни «Дзвінок у вкладці», вибери вкладку з дзвінком
                і увімкни «Also share tab audio». Асистент чутиме тебе через мікрофон, а клієнта — зі вкладки.
                Найкраще в навушниках, у Chrome або Edge.
              </p>
              <div className="flex flex-wrap gap-2">
                {canShareTab && (
                  <button
                    onClick={() => startLive('tab')}
                    disabled={starting}
                    className="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  >
                    {starting ? <Loader2 size={15} className="animate-spin" /> : <MonitorUp size={15} />} Дзвінок у вкладці
                  </button>
                )}
                <button
                  onClick={() => startLive('mic')}
                  disabled={starting}
                  className="flex items-center gap-2 border border-gray-200 hover:border-gray-300 disabled:opacity-50 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors bg-white"
                  title="Жива зустріч або дзвінок на колонках — один мікрофон чує всіх"
                >
                  <Mic size={15} /> Лише мікрофон
                </button>
              </div>
              {startError && <p className="text-xs text-red-500 mt-3">{startError}</p>}
              <p className="text-[11px] text-gray-400 mt-3">
                Попередь клієнта, що розмова транскрибується — у багатьох країнах на запис потрібна згода.
              </p>
            </div>

            {/* Context */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <p className="text-sm font-semibold text-gray-900">Контекст: минулі зустрічі та матеріали</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                    title=".txt, .md, .vtt, .srt"
                  >
                    <Upload size={12} /> Файл
                  </button>
                  <button
                    onClick={() => setAdding(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus size={12} /> Вставити текст
                  </button>
                </div>
              </div>

              {adding && (
                <div className="border border-gray-100 rounded-2xl p-4 mb-3 flex flex-col gap-2.5">
                  <input
                    value={draft.title}
                    onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                    placeholder="Назва — напр. «Зустріч 12 листопада» або «Комерційна пропозиція»"
                    className={field}
                  />
                  <textarea
                    value={draft.content}
                    onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                    rows={8}
                    placeholder="Встав транскрипт попередньої зустрічі, нотатки, листування, умови пропозиції…"
                    className={`${field} resize-y leading-relaxed`}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addDoc}
                      disabled={savingDoc || !draft.content.trim()}
                      className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      {savingDoc && <Loader2 size={13} className="animate-spin" />} Додати в контекст
                    </button>
                    <button onClick={() => { setAdding(false); setDraft({ title: '', content: '' }) }} className="text-sm text-gray-400 hover:text-gray-600 px-2">
                      Скасувати
                    </button>
                    <span className="ml-auto text-[11px] text-gray-300">{draft.content.length.toLocaleString('uk-UA')} символів</span>
                  </div>
                </div>
              )}

              {docs.length === 0 && !adding ? (
                <p className="text-xs text-gray-300 py-4">
                  Поки порожньо. Додай транскрипти минулих зустрічей — і асистент буде в контексті всієї історії з клієнтом.
                  Кожен дзвінок, проведений тут, збережеться сюди автоматично.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {docs.map(d => {
                    const open = openDoc === d.id
                    return (
                      <div key={d.id} className="border border-gray-100 rounded-2xl overflow-hidden">
                        <div
                          onClick={() => setOpenDoc(open ? null : d.id)}
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        >
                          {open ? <ChevronDown size={14} className="text-gray-300 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
                          {d.kind === 'meeting'
                            ? <Captions size={15} className="text-gray-400 flex-shrink-0" />
                            : <FileText size={15} className="text-gray-400 flex-shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{d.title}</p>
                            <p className="text-[11px] text-gray-400">
                              {d.kind === 'meeting' ? 'Дзвінок' : 'Матеріал'} · {fmtDate(d.created_at)} · {(d.content ?? '').length.toLocaleString('uk-UA')} символів
                            </p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); deleteDoc(d) }}
                            className="text-gray-300 hover:text-red-400 p-1.5 flex-shrink-0"
                            title="Видалити"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        {open && (
                          <div className="px-4 pb-4 flex flex-col gap-3">
                            {d.summary && (
                              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                {d.summary}
                              </div>
                            )}
                            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                              {(d.content ?? '').trim() || '— порожньо —'}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <button onClick={deleteRoom} className="self-start flex items-center gap-1.5 text-xs text-gray-300 hover:text-red-400 transition-colors">
              <Trash2 size={12} /> Видалити клієнта
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
