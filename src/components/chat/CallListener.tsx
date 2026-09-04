'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Phone, PhoneOff, Maximize2 } from 'lucide-react'
import VoiceRoom from '@/components/chat/VoiceRoom'
import type { CallRequest } from '@/lib/callBus'
import { startPresence } from '@/lib/presence'

// Global call host, mounted once per layout (admin layout / team layout).
// Because it lives in the layout, an active call keeps running while the
// user navigates between pages. It handles:
// - outgoing/joined calls requested via the gudrix:start-call event
// - incoming invites on the personal Realtime channel call-<selfKey>
// Direct (dm-*) calls open as a big call window; it can be minimized to a
// floating panel and expanded back — the call never drops.

interface IncomingCall {
  roomKey: string
  roomName: string
  from: string
}

export default function CallListener({ selfKey, selfName, selfColor }: {
  selfKey: string
  selfName: string
  selfColor: string
}) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null)
  const [minimized, setMinimized] = useState(false)
  const ringStopRef = useRef<(() => void) | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRoomRef = useRef<string | null>(null)

  useEffect(() => { activeRoomRef.current = activeCall?.roomKey ?? null }, [activeCall])

  // Announce this user as online (Discord-style presence in chats)
  useEffect(() => { startPresence(selfKey, selfName) }, [selfKey, selfName])

  function stopRinging() {
    ringStopRef.current?.()
    ringStopRef.current = null
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }

  function startRinging() {
    stopRinging()
    try {
      const ctx = new AudioContext()
      const chirp = () => {
        const now = ctx.currentTime
        for (const [freq, off] of [[880, 0], [660, 0.25]] as [number, number][]) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.0001, now + off)
          gain.gain.exponentialRampToValueAtTime(0.2, now + off + 0.03)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.4)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(now + off)
          osc.stop(now + off + 0.45)
        }
      }
      chirp()
      const iv = setInterval(chirp, 1600)
      ringStopRef.current = () => { clearInterval(iv); ctx.close() }
    } catch {
      // audio blocked until a user gesture — the visual toast still shows
    }
  }

  // Outgoing / joined calls from any chat on the page
  useEffect(() => {
    const onStart = (e: Event) => {
      const req = (e as CustomEvent<CallRequest>).detail
      if (!req?.roomKey) return
      setActiveCall(req)
      setMinimized(false)
    }
    window.addEventListener('gudrix:start-call', onStart)
    return () => window.removeEventListener('gudrix:start-call', onStart)
  }, [])

  // Incoming invites
  useEffect(() => {
    const channel = supabase.channel(`call-${selfKey}`)
    channel.on('broadcast', { event: 'ring' }, ({ payload }) => {
      const call = payload as IncomingCall
      if (!call?.roomKey) return
      if (activeRoomRef.current === call.roomKey) return // already in this room
      setIncoming(call)
      startRinging()
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = setTimeout(() => { setIncoming(null); stopRinging() }, 30000)
    })
    channel.subscribe()
    return () => {
      stopRinging()
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfKey])

  function accept() {
    if (!incoming) return
    stopRinging()
    setActiveCall({ roomKey: incoming.roomKey, roomName: incoming.roomName })
    setMinimized(false)
    setIncoming(null)
  }

  function decline() {
    stopRinging()
    setIncoming(null)
  }

  const isDirect = activeCall?.roomKey.startsWith('dm-')
  const showModal = activeCall && isDirect && !minimized

  return (
    <>
      {/* Incoming call toast */}
      {incoming && (
        <div className="fixed top-4 right-4 z-[90] w-[320px] max-w-[92vw] bg-white rounded-2xl shadow-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0 animate-pulse">
              <Phone size={17} className="text-white" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{incoming.from} кличе в голосовий</p>
              <p className="text-xs text-gray-400 truncate"># {incoming.roomName}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={accept}
              className="flex-1 flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium py-2 rounded-xl transition-colors"
            >
              <Phone size={14} /> Прийняти
            </button>
            <button
              onClick={decline}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-500 text-sm font-medium py-2 rounded-xl transition-colors"
            >
              <PhoneOff size={14} /> Відхилити
            </button>
          </div>
        </div>
      )}

      {/* Active call: big window for direct calls, floating panel otherwise
          (or when a direct call is minimized). The call itself never
          unmounts on minimize — only its container changes. */}
      {activeCall && (
        <div className={showModal ? '' : 'fixed bottom-4 right-4 z-[70] w-[380px] max-w-[92vw] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden'}>
          {!showModal && (
            <div className="flex items-center justify-between px-4 pt-2.5">
              <p className="text-[11px] font-semibold text-gray-500 truncate"># {activeCall.roomName}</p>
              {isDirect && (
                <button
                  onClick={() => setMinimized(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
                  title="Розгорнути вікно дзвінка"
                >
                  <Maximize2 size={13} />
                </button>
              )}
            </div>
          )}
          <VoiceRoom
            key={activeCall.roomKey}
            roomKey={activeCall.roomKey}
            roomName={activeCall.roomName}
            ringKeys={activeCall.ringKeys}
            variant={showModal ? 'modal' : 'bar'}
            onMinimize={isDirect ? () => setMinimized(true) : undefined}
            self={{ key: selfKey, name: selfName, color: selfColor }}
            onLeave={() => setActiveCall(null)}
          />
        </div>
      )}
    </>
  )
}
