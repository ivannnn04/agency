'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'

// The client workspace's top bar: the same dark chrome and wordmark as the
// rest of the platform.

export function PortalPreviewBanner({ text }: { text: string }) {
  return <div className="bg-amber-400 text-amber-950 text-xs font-medium px-4 py-1.5 text-center">{text}</div>
}

export function PortalHeader({ label, backHref, right }: {
  label: string
  backHref?: string
  right?: React.ReactNode
}) {
  return (
    <header className="bg-[#00140c] border-b border-white/5">
      <div className="px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {backHref && (
            <Link href={backHref} className="text-white/50 hover:text-white transition-colors -ml-1 p-1" aria-label="Back">
              <ArrowLeft size={17} />
            </Link>
          )}
          <span className="text-white font-extrabold text-xl tracking-tight leading-none lowercase">
            gudrix<span className="text-[#2affaa]">.</span>
          </span>
          <span className="hidden sm:block w-px h-4 bg-white/15" />
          <span className="hidden sm:block text-[13px] text-white/50 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ThemeToggle variant="sidebar" />
          {right}
        </div>
      </div>
    </header>
  )
}
