'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Camera, RotateCcw, Sparkles, Download, Loader2, Upload, X } from 'lucide-react'

// Public demo page for a client: take a selfie, AI composes you between two
// event hosts on a festive postcard, download it. Shareable test — no login.

type Phase = 'start' | 'camera' | 'preview' | 'generating' | 'result' | 'error'

export default function PhotoDemoPage() {
  const [phase, setPhase] = useState<Phase>('start')
  const [photoUrl, setPhotoUrl] = useState('')        // local preview of the selfie
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [resultUrl, setResultUrl] = useState('')      // generated postcard (data URL)
  const [message, setMessage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  async function openCamera() {
    setMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
      })
      streamRef.current = stream
      setPhase('camera')
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      })
    } catch {
      // Camera denied — fall back to the file picker (mobile opens the camera anyway)
      fileRef.current?.click()
    }
  }

  // Downscale to ~1024px JPEG so the upload stays tiny
  async function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
    const max = 1024
    const scale = Math.min(1, max / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
    return await new Promise(res => canvas.toBlob(b => res(b!), 'image/jpeg', 0.9))
  }

  async function snap() {
    const video = videoRef.current
    if (!video) return
    const blob = await toJpeg(video, video.videoWidth, video.videoHeight)
    stopCamera()
    setPhotoBlob(blob)
    setPhotoUrl(URL.createObjectURL(blob))
    setPhase('preview')
  }

  async function onFile(f: File | null) {
    if (!f) return
    const img = new Image()
    img.src = URL.createObjectURL(f)
    await new Promise(res => { img.onload = res })
    const blob = await toJpeg(img, img.naturalWidth, img.naturalHeight)
    URL.revokeObjectURL(img.src)
    setPhotoBlob(blob)
    setPhotoUrl(URL.createObjectURL(blob))
    setPhase('preview')
  }

  async function generate() {
    if (!photoBlob) return
    setPhase('generating')
    setMessage('')
    try {
      const form = new FormData()
      form.append('photo', new File([photoBlob], 'selfie.jpg', { type: 'image/jpeg' }))
      const res = await fetch('/api/photo-card', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Щось пішло не так')
      setResultUrl(data.image)
      setPhase('result')
    } catch (e) {
      setMessage((e as Error).message)
      setPhase('error')
    }
  }

  function reset() {
    stopCamera()
    setPhotoUrl('')
    setPhotoBlob(null)
    setResultUrl('')
    setMessage('')
    setPhase('start')
  }

  return (
    <div className="min-h-screen bg-[#00140c] flex flex-col items-center px-4 py-8">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={e => { onFile(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      {/* Brand */}
      <p className="text-white font-extrabold text-2xl tracking-tight lowercase mb-1">
        gudrix<span className="text-[#2affaa]">.</span>
      </p>
      <p className="text-white/40 text-xs mb-8">AI-листівка з івенту · демо</p>

      <div className="w-full max-w-md flex flex-col items-center">
        {phase === 'start' && (
          <>
            <div className="text-center mb-8">
              <p className="text-white text-xl font-bold leading-snug mb-3">
                Зроби селфі — і опинись на сцені<br />між ведучими івенту 🎉
              </p>
              <p className="text-white/50 text-sm leading-relaxed">
                AI згенерує святкову листівку з тобою в головній ролі.
                Збережи її собі на згадку.
              </p>
            </div>
            <button
              onClick={openCamera}
              className="w-full flex items-center justify-center gap-2 bg-white hover:bg-[#2affaa] text-[#00140c] font-semibold text-base rounded-2xl py-4 transition-colors mb-3"
            >
              <Camera size={18} /> Зробити фото
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border border-white/25 hover:border-[#2affaa] hover:text-[#2affaa] text-white font-medium text-sm rounded-2xl py-3.5 transition-colors"
            >
              <Upload size={15} /> Завантажити з галереї
            </button>
          </>
        )}

        {phase === 'camera' && (
          <>
            <div className="relative w-full rounded-3xl overflow-hidden bg-black mb-4">
              <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-[3/4] object-cover -scale-x-100" />
            </div>
            <div className="flex items-center gap-4">
              <button onClick={reset} className="text-white/50 hover:text-white p-3" title="Скасувати"><X size={20} /></button>
              <button
                onClick={snap}
                className="w-16 h-16 rounded-full bg-white hover:bg-[#2affaa] transition-colors border-4 border-white/30"
                title="Зробити фото"
              />
              <span className="w-11" />
            </div>
          </>
        )}

        {(phase === 'preview' || phase === 'generating') && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="selfie" className="w-full rounded-3xl mb-4" />
            {phase === 'preview' ? (
              <div className="w-full flex flex-col gap-2.5">
                <button
                  onClick={generate}
                  className="w-full flex items-center justify-center gap-2 bg-[#2affaa] hover:bg-[#7dffcc] text-[#00140c] font-bold text-base rounded-2xl py-4 transition-colors"
                >
                  <Sparkles size={17} /> Згенерувати листівку
                </button>
                <button
                  onClick={reset}
                  className="w-full flex items-center justify-center gap-2 text-white/50 hover:text-white text-sm py-2 transition-colors"
                >
                  <RotateCcw size={13} /> Перезняти
                </button>
              </div>
            ) : (
              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                <Loader2 size={22} className="animate-spin text-[#2affaa] mx-auto mb-2" />
                <p className="text-white text-sm font-medium">Чаклуємо над листівкою…</p>
                <p className="text-white/40 text-xs mt-1">зазвичай 20–40 секунд — не закривай сторінку</p>
              </div>
            )}
          </>
        )}

        {phase === 'result' && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="Листівка" className="w-full rounded-3xl mb-4 shadow-2xl" />
            <div className="w-full flex flex-col gap-2.5">
              <a
                href={resultUrl}
                download="gudrix-event-card.png"
                className="w-full flex items-center justify-center gap-2 bg-[#2affaa] hover:bg-[#7dffcc] text-[#00140c] font-bold text-base rounded-2xl py-4 transition-colors"
              >
                <Download size={17} /> Зберегти листівку
              </a>
              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 text-white/50 hover:text-white text-sm py-2 transition-colors"
              >
                <RotateCcw size={13} /> Спробувати ще раз
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="text-red-400 text-sm text-center mb-4">{message}</p>
            <button
              onClick={() => (photoBlob ? generate() : reset())}
              className="flex items-center gap-2 bg-white hover:bg-[#2affaa] text-[#00140c] font-semibold text-sm rounded-2xl px-6 py-3 transition-colors"
            >
              <RotateCcw size={14} /> Спробувати ще раз
            </button>
          </>
        )}
      </div>

      <p className="text-white/25 text-[11px] mt-auto pt-10 text-center max-w-xs">
        Демо-функціонал для корпоративних івентів: фон, ведучі та дизайн листівки
        налаштовуються під бренд клієнта.
      </p>
    </div>
  )
}
