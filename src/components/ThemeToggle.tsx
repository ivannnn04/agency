'use client'

import { useState, useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'

// Light/dark theme switch. The theme is a `dark` class on <html>, persisted in
// localStorage and applied before first paint by the inline script in layout.tsx.
// variant 'sidebar' styles the button for the always-dark admin sidebar.
export default function ThemeToggle({ variant = 'page' }: { variant?: 'page' | 'sidebar' }) {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('gudrix:theme', next ? 'dark' : 'light') } catch {}
  }

  const cls = variant === 'sidebar'
    ? 'text-gray-500 hover:text-white hover:bg-white/5'
    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'

  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-lg transition-colors ${cls}`}
      title={dark ? 'Світла тема' : 'Темна тема'}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
