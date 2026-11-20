'use client'

import { useEffect, useState } from 'react'
import { Play, X } from 'lucide-react'
import type { PortalText } from '@/lib/portalI18n'

// The one-minute narrated walkthrough of the client workspace, offered on the
// workspace home. Dismissing the card keeps a small "watch again" link.

const VIDEO = '/onboarding/workspace-tour-en.mp4'
const POSTER = '/onboarding/workspace-tour-poster.jpg'
const HIDE_KEY = 'gudrix:portalTourHidden'

export function usePortalTour() {
  const [hidden, setHidden] = useState(true)   // until storage is read: no flash for returning clients
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let stored = false
    try { stored = localStorage.getItem(HIDE_KEY) === '1' } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only preference
    setHidden(stored)
  }, [])

  function hide() {
    setHidden(true)
    try { localStorage.setItem(HIDE_KEY, '1') } catch { /* storage unavailable */ }
  }

  return { hidden, hide, open, setOpen }
}

export function PortalTourCard({ t, onPlay, onHide }: { t: PortalText; onPlay: () => void; onHide: () => void }) {
  return (
    <div className="relative mt-10 border border-gray-100 bg-gray-50 rounded-3xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
      <button
        onClick={onPlay}
        className="group relative w-full md:w-[340px] flex-shrink-0 aspect-video rounded-2xl overflow-hidden bg-[#09090b]"
        aria-label={t.tourWatch}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static poster from /public */}
        <img src={POSTER} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <span className="absolute inset-0 bg-black/25 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-[#2affaa] text-[#09090b] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play size={22} className="ml-0.5" fill="currentColor" />
          </span>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">{t.tourEyebrow}</p>
        <p className="text-2xl font-semibold text-gray-900 tracking-tight mt-2">{t.tourTitle}</p>
        <p className="text-gray-500 mt-2 max-w-xl leading-relaxed">{t.tourSub}</p>
        <button
          onClick={onPlay}
          className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors mt-5"
        >
          <Play size={14} fill="currentColor" /> {t.tourWatch}
        </button>
      </div>
      <button onClick={onHide} className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-900 transition-colors" title={t.tourHide} aria-label={t.tourHide}>
        <X size={16} />
      </button>
    </div>
  )
}

export function PortalTourModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="on-dark fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <div className="relative w-full max-w-6xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 p-2 text-white/70 hover:text-white transition-colors" aria-label="Close">
          <X size={20} />
        </button>
        <video src={VIDEO} poster={POSTER} controls autoPlay playsInline className="w-full aspect-video rounded-2xl bg-black shadow-2xl" />
      </div>
    </div>
  )
}
