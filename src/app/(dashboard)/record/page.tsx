'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Clapperboard, Square, Loader2, Copy, Check, Trash2, ExternalLink, Mic, MicOff, CloudUpload, Camera, CameraOff } from 'lucide-react'

// Loom-style screen recording with UNLIMITED length: while recording, the
// stream is cut into ~40MB parts that upload in the background (each part
// stays under Supabase's per-file limit). The public /r/<id> player stitches
// the parts back into one seamless video.

interface Recording {
  id: string
  title: string
  file_url: string
  file_urls?: string[] | null
  mime_type?: string | null
  duration_seconds: number
  created_at: string
}

const PART_LIMIT = 40 * 1024 * 1024 // 40MB per uploaded part

function fmtDur(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function RecordPage() {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [dbError, setDbError] = useState('')

  const [recording, setRecording] = useState(false)
  const [withMic, setWithMic] = useState(true)
  const [withCam, setWithCam] = useState(false)
  const [camPreview, setCamPreview] = useState<MediaStream | null>(null)
  const [recSec, setRecSec] = useState(0)
  const [uploadedParts, setUploadedParts] = useState(0)
  const [uploadingPart, setUploadingPart] = useState(false)

  const [previewUrl, setPreviewUrl] = useState('')
  const [previewDur, setPreviewDur] = useState(0)
  const [pendingSave, setPendingSave] = useState(false) // parts uploaded, waiting for title+save
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const allChunksRef = useRef<Blob[]>([])   // full local copy (for preview)
  const partBufRef = useRef<Blob[]>([])     // chunks waiting to become the next part
  const partBytesRef = useRef(0)
  const partUrlsRef = useRef<string[]>([])
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve())
  const sessionRef = useRef('')
  const mimeRef = useRef('')
  const streamsRef = useRef<MediaStream[]>([])
  const startedAtRef = useRef(0)
  const stoppedRef = useRef<(() => void) | null>(null)
  // Canvas compositor (screen + camera bubble); worker timer keeps drawing
  // even when the tab is in the background (rAF/setInterval get throttled)
  const compositorRef = useRef<{ worker: Worker; url: string; videos: HTMLVideoElement[] } | null>(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!recording) return
    const iv = setInterval(() => setRecSec(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500)
    return () => clearInterval(iv)
  }, [recording])

  async function load() {
    const { data, error } = await supabase
      .from('screen_recordings')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { setDbError('Запусти міграцію screen_recordings_migration.sql'); return }
    setRecordings((data ?? []) as Recording[])
  }

  // Upload the buffered chunks as the next numbered part (sequential queue
  // keeps the order even if a part finishes slowly)
  function flushPart(force = false) {
    if (partBufRef.current.length === 0) return
    if (!force && partBytesRef.current < PART_LIMIT) return
    const partBlob = new Blob(partBufRef.current, { type: mimeRef.current || 'video/webm' })
    partBufRef.current = []
    partBytesRef.current = 0
    const index = partUrlsRef.current.length + 1
    const path = `recordings/${sessionRef.current}-part${String(index).padStart(3, '0')}.webm`
    partUrlsRef.current.push('') // reserve the slot to keep ordering
    const slot = index - 1
    uploadChainRef.current = uploadChainRef.current.then(async () => {
      setUploadingPart(true)
      const { error } = await supabase.storage.from('chat-files').upload(path, partBlob, {
        contentType: mimeRef.current || 'video/webm',
      })
      setUploadingPart(false)
      if (error) {
        setDbError(`Не вдалося вивантажити частину ${index}: ${error.message}`)
        return
      }
      const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
      partUrlsRef.current[slot] = pub.publicUrl
      setUploadedParts(p => p + 1)
    })
  }

  async function startRecording() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      })
      streamsRef.current = [display]

      const audioCtx = new AudioContext()
      const dest = audioCtx.createMediaStreamDestination()
      let hasAudio = false
      if (display.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest)
        hasAudio = true
      }
      if (withMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } })
          streamsRef.current.push(mic)
          audioCtx.createMediaStreamSource(mic).connect(dest)
          hasAudio = true
        } catch { /* mic denied — record without it */ }
      }

      // Front camera → composite it as a round bubble onto the screen video
      let videoTracks: MediaStreamTrack[] = display.getVideoTracks()
      if (withCam) {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          })
          streamsRef.current.push(cam)
          setCamPreview(cam)

          const screenVideo = document.createElement('video')
          screenVideo.srcObject = new MediaStream(display.getVideoTracks())
          screenVideo.muted = true
          const camVideo = document.createElement('video')
          camVideo.srcObject = new MediaStream(cam.getVideoTracks())
          camVideo.muted = true
          await Promise.all([screenVideo.play(), camVideo.play()])

          const s = display.getVideoTracks()[0].getSettings()
          const canvas = document.createElement('canvas')
          canvas.width = s.width || 1920
          canvas.height = s.height || 1080
          const ctx = canvas.getContext('2d')!

          const draw = () => {
            ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)
            const d = Math.round(Math.min(canvas.width, canvas.height) * 0.32)
            const m = Math.round(d * 0.12)
            const cx = canvas.width - m - d / 2
            const cy = canvas.height - m - d / 2
            const vw = camVideo.videoWidth || 1280
            const vh = camVideo.videoHeight || 720
            const side = Math.min(vw, vh)
            ctx.save()
            ctx.beginPath()
            ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
            ctx.closePath()
            ctx.clip()
            ctx.drawImage(camVideo, (vw - side) / 2, (vh - side) / 2, side, side, cx - d / 2, cy - d / 2, d, d)
            ctx.restore()
            ctx.beginPath()
            ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
            ctx.lineWidth = Math.max(4, Math.round(d * 0.03))
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'
            ctx.stroke()
          }
          draw()
          const workerUrl = URL.createObjectURL(new Blob(
            ['setInterval(function(){postMessage(0)},33)'],
            { type: 'application/javascript' },
          ))
          const worker = new Worker(workerUrl)
          worker.onmessage = draw
          compositorRef.current = { worker, url: workerUrl, videos: [screenVideo, camVideo] }

          videoTracks = canvas.captureStream(30).getVideoTracks()
        } catch { /* camera denied — record screen only */ }
      }

      const combined = new MediaStream([
        ...videoTracks,
        ...(hasAudio ? dest.stream.getAudioTracks() : []),
      ])

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : ''
      const rec = new MediaRecorder(combined, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      })
      mimeRef.current = rec.mimeType || mime || 'video/webm'
      sessionRef.current = `rec-${Date.now()}`
      allChunksRef.current = []
      partBufRef.current = []
      partBytesRef.current = 0
      partUrlsRef.current = []
      uploadChainRef.current = Promise.resolve()
      setUploadedParts(0)
      setDbError('')

      rec.ondataavailable = e => {
        if (e.data.size === 0) return
        allChunksRef.current.push(e.data)
        partBufRef.current.push(e.data)
        partBytesRef.current += e.data.size
        flushPart()
      }
      rec.onstop = () => {
        const dur = Math.floor((Date.now() - startedAtRef.current) / 1000)
        streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()))
        streamsRef.current = []
        audioCtx.close()
        if (compositorRef.current) {
          compositorRef.current.worker.terminate()
          URL.revokeObjectURL(compositorRef.current.url)
          compositorRef.current.videos.forEach(v => { v.pause(); v.srcObject = null })
          compositorRef.current = null
        }
        combined.getVideoTracks().forEach(t => t.stop())
        setCamPreview(null)
        flushPart(true) // upload the tail
        const blob = new Blob(allChunksRef.current, { type: mimeRef.current })
        setPreviewUrl(URL.createObjectURL(blob))
        setPreviewDur(dur)
        setPendingSave(true)
        setTitle(`Запис ${new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`)
        setRecording(false)
        setRecSec(0)
      }
      display.getVideoTracks()[0].onended = () => { if (rec.state !== 'inactive') rec.stop() }

      rec.start(3000) // a chunk every 3s — parts can flush mid-recording
      recRef.current = rec
      startedAtRef.current = Date.now()
      setRecSec(0)
      setRecording(true)
    } catch { /* user cancelled the screen picker */ }
  }

  function stopRecording() {
    recRef.current?.stop()
  }

  async function saveRecording() {
    if (saving) return
    setSaving(true)
    setDbError('')
    await uploadChainRef.current // wait for every part to finish uploading
    const urls = partUrlsRef.current.filter(Boolean)
    if (urls.length === 0) {
      setSaving(false)
      setDbError('Жодна частина не вивантажилась — спробуй ще раз')
      return
    }
    const { data, error } = await supabase
      .from('screen_recordings')
      .insert({
        title: title.trim() || 'Запис екрана',
        file_url: urls[0],
        file_urls: urls,
        mime_type: mimeRef.current,
        duration_seconds: previewDur,
      })
      .select()
      .single()
    setSaving(false)
    if (error) {
      setDbError(error.message.includes('file_urls')
        ? 'Запусти міграцію screen_recordings_migration.sql (нові колонки file_urls, mime_type)'
        : 'Не вдалося зберегти: ' + error.message)
      return
    }
    if (data) setRecordings(prev => [data as Recording, ...prev])
    cleanupPreview()
  }

  async function discardPreview() {
    // remove already-uploaded parts from storage
    await uploadChainRef.current
    const paths = partUrlsRef.current.filter(Boolean).map(u => {
      const idx = u.indexOf('/chat-files/')
      return decodeURIComponent(u.slice(idx + '/chat-files/'.length))
    })
    if (paths.length > 0) await supabase.storage.from('chat-files').remove(paths)
    cleanupPreview()
  }

  function cleanupPreview() {
    URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setPendingSave(false)
    allChunksRef.current = []
    partUrlsRef.current = []
    setUploadedParts(0)
    setTitle('')
  }

  function shareLink(id: string) {
    return `${window.location.origin}/r/${id}`
  }

  async function copyLink(id: string) {
    await navigator.clipboard.writeText(shareLink(id))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  async function deleteRecording(r: Recording) {
    if (!window.confirm(`Видалити запис «${r.title}»? Публічний лінк перестане працювати.`)) return
    setRecordings(prev => prev.filter(x => x.id !== r.id))
    await supabase.from('screen_recordings').delete().eq('id', r.id)
    const urls = (r.file_urls && r.file_urls.length > 0 ? r.file_urls : [r.file_url])
    const paths = urls.map(u => {
      const idx = u.indexOf('/chat-files/')
      return idx === -1 ? '' : decodeURIComponent(u.slice(idx + '/chat-files/'.length))
    }).filter(Boolean)
    if (paths.length > 0) await supabase.storage.from('chat-files').remove(paths)
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Запис екрана</h1>
      <p className="text-xs text-gray-400 mb-6">
        Довжина не обмежена — відео вивантажується частинами прямо під час запису.
      </p>

      {dbError && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3 mb-4">{dbError}</div>
      )}

      {/* Recorder */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        {pendingSave ? (
          <div className="flex flex-col gap-3">
            <video src={previewUrl} controls className="w-full rounded-xl bg-black max-h-[380px]" />
            <div className="flex items-center gap-2">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Назва запису..."
                className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-gray-900"
              />
              <button
                onClick={saveRecording}
                disabled={saving}
                className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                {saving ? <><Loader2 size={14} className="animate-spin" /> Зберігаємо...</> : 'Зберегти'}
              </button>
              <button
                onClick={discardPreview}
                disabled={saving}
                className="text-gray-400 hover:text-red-500 text-sm px-2 transition-colors"
              >
                Відкинути
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              Тривалість: {fmtDur(previewDur)} · частин вивантажено: {uploadedParts}
              {uploadingPart && <> · <Loader2 size={10} className="inline animate-spin" /> вивантажуємо...</>}
            </p>
          </div>
        ) : recording ? (
          <div className="flex items-center gap-4 flex-wrap">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <p className="text-sm font-mono text-red-600">{fmtDur(recSec)}</p>
            {camPreview && (
              <video
                ref={el => { if (el && el.srcObject !== camPreview) el.srcObject = camPreview }}
                autoPlay
                muted
                playsInline
                className="w-12 h-12 rounded-full object-cover -scale-x-100 border-2 border-teal-400 bg-black flex-shrink-0"
                title="Камера пишеться кружечком у відео"
              />
            )}
            <p className="text-sm text-gray-500 flex-1">Йде запис екрана...</p>
            {(uploadedParts > 0 || uploadingPart) && (
              <span className="flex items-center gap-1.5 text-[11px] text-teal-600 bg-teal-50 px-2 py-1 rounded-lg">
                <CloudUpload size={12} /> {uploadedParts} ч. у хмарі{uploadingPart ? '…' : ''}
              </span>
            )}
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              <Square size={13} fill="currentColor" /> Зупинити
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={startRecording}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-5 py-3 rounded-xl text-sm font-semibold transition-colors"
            >
              <Clapperboard size={16} /> Почати запис
            </button>
            <button
              onClick={() => setWithMic(v => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-3 rounded-xl text-sm font-medium border transition-colors ${
                withMic ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-400 border-gray-200'
              }`}
              title="Мікрофон під час запису"
            >
              {withMic ? <Mic size={14} /> : <MicOff size={14} />} {withMic ? 'З мікрофоном' : 'Без мікрофона'}
            </button>
            <button
              onClick={() => setWithCam(v => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-3 rounded-xl text-sm font-medium border transition-colors ${
                withCam ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-400 border-gray-200'
              }`}
              title="Фронтальна камера кружечком поверх запису"
            >
              {withCam ? <Camera size={14} /> : <CameraOff size={14} />} {withCam ? 'З камерою' : 'Без камери'}
            </button>
            <p className="text-[11px] text-gray-400 w-full">
              Обереш вкладку/вікно/екран у діалозі браузера. Кнопка «Stop sharing» теж завершує запис.
              {withCam && ' Камера буде видима кружечком у правому нижньому куті відео.'}
            </p>
          </div>
        )}
      </div>

      {/* Saved recordings */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Мої записи</h2>
      {recordings.length === 0 ? (
        <p className="text-xs text-gray-300 py-4">Ще немає записів</p>
      ) : (
        <div className="flex flex-col gap-2">
          {recordings.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
              <Clapperboard size={16} className="text-red-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                <p className="text-[11px] text-gray-400">
                  {new Date(r.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {r.duration_seconds > 0 && <> · {fmtDur(r.duration_seconds)}</>}
                </p>
              </div>
              <button
                onClick={() => copyLink(r.id)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  copiedId === r.id ? 'bg-teal-500 text-white' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                }`}
              >
                {copiedId === r.id ? <><Check size={12} /> Скопійовано</> : <><Copy size={12} /> Лінк</>}
              </button>
              <a
                href={shareLink(r.id)}
                target="_blank"
                rel="noreferrer"
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg transition-colors"
                title="Відкрити"
              >
                <ExternalLink size={14} />
              </a>
              <button
                onClick={() => deleteRecording(r)}
                className="text-gray-300 hover:text-red-400 p-1.5 rounded-lg transition-colors"
                title="Видалити"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
