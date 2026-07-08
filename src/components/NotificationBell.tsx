'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Bell, X, CheckCheck } from 'lucide-react'

interface Notification {
  id: string
  message: string
  type: string
  read: boolean
  created_at: string
  recipient_team_member_id?: string | null
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchNotifications()

    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
        const n = payload.new as Notification
        // Personal designer notifications are shown in their own bell, not here
        if (n.recipient_team_member_id) return
        setNotifications(prev => [n, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .is('recipient_team_member_id', null)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setNotifications(data)
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function dismiss(id: string) {
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const unread = notifications.filter(n => !n.read).length

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'щойно'
    if (min < 60) return `${min}хв тому`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}г тому`
    return new Date(dateStr).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(v => !v); if (!open && unread > 0) markAllRead() }}
        className="relative text-gray-400 hover:text-white transition-colors p-1"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 w-80">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Сповіщення</p>
            {notifications.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
                title="Позначити всі як прочитані"
              >
                <CheckCheck size={13} /> Всі прочитані
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <Bell size={24} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Сповіщень немає</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 group ${!n.read ? 'bg-blue-50/40' : ''}`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.read ? 'bg-blue-400' : 'bg-gray-200'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-snug">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={() => dismiss(n.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 flex-shrink-0 transition-all"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
