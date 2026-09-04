'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// Public viewer for a shared screen recording — no login required.

interface Rec {
  id: string
  title: string
  file_url: string
  duration_seconds: number
  created_at: string
}

export default function PublicRecordingPage() {
  const { id } = useParams<{ id: string }>()
  const [rec, setRec] = useState<Rec | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const res = await fetch(`/api/recordings/${id}`)
      if (!res.ok) { setNotFound(true); return }
      setRec(await res.json())
    })()
  }, [id])

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
            </p>
            <video
              src={rec.file_url}
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
