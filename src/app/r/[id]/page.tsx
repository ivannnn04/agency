'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

// Public viewer for a shared screen recording — no login required.
// Long recordings are stored as multiple parts; MediaSource stitches them
// into one seamless video (with a concat-blob fallback).

interface Rec {
  id: string
  title: string
  file_url: string
  file_urls?: string[] | null
  mime_type?: string | null
  duration_seconds: number
  created_at: string
}

function mseMime(stored: string | null | undefined): string | null {
  const candidates = [
    stored ?? '',
    (stored ?? '').replace(/codecs=([^"].*)$/, 'codecs="$1"'),
    'video/webm; codecs="vp9,opus"',
    'video/webm; codecs="vp8,opus"',
    'video/webm',
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (MediaSource.isTypeSupported(c)) return c } catch { /* no MSE */ }
  }
  return null
}

export default function PublicRecordingPage() {
  const { id } = useParams<{ id: string }>()
  const [rec, setRec] = useState<Rec | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadingParts, setLoadingParts] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const res = await fetch(`/api/recordings/${id}`)
      if (!res.ok) { setNotFound(true); return }
      setRec(await res.json())
    })()
  }, [id])

  // Attach the source once the video element and metadata are ready
  useEffect(() => {
    const video = videoRef.current
    if (!video || !rec) return
    const urls = rec.file_urls && rec.file_urls.length > 0 ? rec.file_urls : [rec.file_url]

    if (urls.length === 1) {
      video.src = urls[0]
      return
    }

    let cancelled = false
    const mime = typeof window !== 'undefined' && 'MediaSource' in window ? mseMime(rec.mime_type) : null

    async function concatFallback() {
      setLoadingParts(true)
      const parts: BlobPart[] = []
      for (const u of urls) {
        if (cancelled) return
        parts.push(await (await fetch(u)).arrayBuffer())
      }
      setLoadingParts(false)
      if (cancelled) return
      const blob = new Blob(parts, { type: rec!.mime_type ?? 'video/webm' })
      video!.src = URL.createObjectURL(blob)
    }

    async function streamParts() {
      const ms = new MediaSource()
      video!.src = URL.createObjectURL(ms)
      await new Promise<void>(resolve => ms.addEventListener('sourceopen', () => resolve(), { once: true }))
      let sb: SourceBuffer
      try {
        sb = ms.addSourceBuffer(mime!)
      } catch {
        concatFallback()
        return
      }
      try {
        for (const u of urls) {
          if (cancelled) return
          const buf = await (await fetch(u)).arrayBuffer()
          await new Promise<void>((resolve, reject) => {
            const onErr = () => reject(new Error('append failed'))
            sb.addEventListener('updateend', () => { sb.removeEventListener('error', onErr); resolve() }, { once: true })
            sb.addEventListener('error', onErr, { once: true })
            sb.appendBuffer(buf)
          })
        }
        if (ms.readyState === 'open') ms.endOfStream()
      } catch {
        if (!cancelled) concatFallback()
      }
    }

    if (mime) streamParts()
    else concatFallback()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      <header className="px-6 py-4 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">G</span>
        </div>
        <p className="text-white font-semibold text-sm">Gudrix</p>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-10">
        {notFound ? (
          <p className="text-gray-400 text-sm">Запис не знайдено або його видалили 😔</p>
        ) : !rec ? (
          <p className="text-gray-500 text-sm">Завантаження...</p>
        ) : (
          <div className="w-full max-w-4xl">
            <h1 className="text-white text-lg font-bold mb-1">{rec.title}</h1>
            <p className="text-gray-500 text-xs mb-4">
              {new Date(rec.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {loadingParts && ' · довантажуємо відео...'}
            </p>
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              className="w-full rounded-2xl bg-black shadow-2xl"
            />
          </div>
        )}
      </main>
    </div>
  )
}
