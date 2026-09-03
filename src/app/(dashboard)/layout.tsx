'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import Sidebar from '@/components/sidebar/Sidebar'
import AddTransactionModal from '@/components/modals/AddTransactionModal'
import { Settings, Plus, Minus, ArrowLeftRight, Menu, X } from 'lucide-react'
import { TransactionType } from '@/types'
import NotificationBell from '@/components/NotificationBell'
import CallListener from '@/components/chat/CallListener'
import { getAdminProfile } from '@/lib/adminProfile'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<TransactionType>('income')
  const [refreshKey, setRefreshKey] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const [adminName, setAdminName] = useState('Ivan')
  useEffect(() => { getAdminProfile().then(p => setAdminName(p.name)) }, [])

  // Navigating from the mobile drawer closes it
  useEffect(() => { setNavOpen(false) }, [pathname])

  function openModal(type: TransactionType) {
    setModalType(type)
    setModalOpen(true)
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Incoming voice-call invites (admin) */}
      <CallListener selfKey="admin" selfName={adminName} selfColor="#0ea5e9" />
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar key={refreshKey} />
      </div>

      {/* Mobile sidebar drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setNavOpen(false)} />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 h-full flex md:hidden transform transition-transform duration-200 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar key={`m-${refreshKey}`} />
        <button
          onClick={() => setNavOpen(false)}
          className="self-start mt-3 ml-2 bg-white/10 text-white rounded-lg p-2"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-[#0f1117] px-3 sm:px-6 py-3 flex items-center justify-between gap-2 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {/* Mobile burger */}
            <button
              onClick={() => setNavOpen(true)}
              className="md:hidden text-gray-400 hover:text-white p-2 -ml-1 rounded-lg flex-shrink-0"
              title="Меню"
            >
              <Menu size={18} />
            </button>
            <button
              onClick={() => openModal('income')}
              className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={14} /> <span className="hidden xs:inline sm:inline">Дохід</span>
            </button>
            <button
              onClick={() => openModal('expense')}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Minus size={14} /> <span className="hidden xs:inline sm:inline">Витрата</span>
            </button>
            <button
              onClick={() => openModal('transfer')}
              className="flex items-center gap-1.5 bg-gray-600 hover:bg-gray-500 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <ArrowLeftRight size={14} /> <span className="hidden sm:inline">Переказ</span>
            </button>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <NotificationBell />
            <button onClick={() => signOut()} className="text-gray-400 hover:text-white transition-colors">
              <Settings size={18} />
            </button>
          </div>
        </header>

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
