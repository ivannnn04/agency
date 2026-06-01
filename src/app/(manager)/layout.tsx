'use client'

import { signOut, useSession } from 'next-auth/react'
import { LogOut } from 'lucide-react'

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-[#0f1117] px-6 py-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">F</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Ліди</p>
            <p className="text-gray-500 text-xs">{session?.user?.name ?? 'Менеджер'}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <LogOut size={15} /> Вийти
        </button>
      </header>
      <main className="p-6 max-w-5xl mx-auto">
        {children}
      </main>
    </div>
  )
}
