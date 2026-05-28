'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import Sidebar from '@/components/sidebar/Sidebar'
import AddTransactionModal from '@/components/modals/AddTransactionModal'
import { Settings, Clock, Plus, Minus, ArrowLeftRight } from 'lucide-react'
import { TransactionType } from '@/types'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<TransactionType>('income')
  const [refreshKey, setRefreshKey] = useState(0)

  function openModal(type: TransactionType) {
    setModalType(type)
    setModalOpen(true)
  }

  const tabs = [
    { label: 'Платежі', href: '/' },
    { label: 'Аналітика', href: '/analytics' },
  ]

  return (
    <div className="flex h-screen bg-[#f5f5f5] overflow-hidden">
      <Sidebar key={refreshKey} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-[#0f1117] px-6 py-3 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">F</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Моя компанія</p>
              <p className="text-gray-500 text-xs">фінансовий трекер</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openModal('income')}
              className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={14} /> Дохід
            </button>
            <button
              onClick={() => openModal('expense')}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Minus size={14} /> Витрата
            </button>
            <button
              onClick={() => openModal('transfer')}
              className="flex items-center gap-1.5 bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <ArrowLeftRight size={14} /> Переказ
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-white transition-colors">
              <Clock size={18} />
            </button>
            <button onClick={() => signOut()} className="text-gray-400 hover:text-white transition-colors">
              <Settings size={18} />
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="bg-white border-b border-gray-200 px-6 flex items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                pathname === tab.href || (tab.href === '/analytics' && pathname.startsWith('/analytics'))
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-white">
          {children}
        </main>
      </div>

      <AddTransactionModal
        open={modalOpen}
        defaultType={modalType}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false)
          setRefreshKey(k => k + 1)
        }}
      />
    </div>
  )
}
