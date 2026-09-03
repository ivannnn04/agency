'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Mic, MicOff, PhoneOff, Loader2, UserPlus, Check } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Live voice room for internal chats (Discord-style): WebRTC mesh audio
// between participants, with Supabase Realtime as the signaling layer
// (presence = who's in the room, broadcast = offer/answer/ICE exchange).
// Team + admin only — the client portal never renders this.

export interface VoicePeerInfo {
  key: string   // unique id: team member id or 'admin'
  name: string
  color: string
}

interface SignalMsg {
  from: string
  to: string
  kind: 'offer' | 'answer' | 'ice'
  sdp?: string
  candidate?: RTCIceCandidateInit
  name?: string
  color?: string
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export default function VoiceRoom({ roomKey, roomName, self, onLeave }: {
  roomKey: string
  roomName?: string
  self: VoicePeerInfo
  onLeave: () => void
}) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [participants, setParticipants] = useState<VoicePeerInfo[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})

  const channelRef = useRef<RealtimeChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  const sendSignal = useCallback((msg: SignalMsg) => {
    channelRef.current?.send({ type: 'broadcast', event: 'signal', payload: msg })
  }, [])

  const closePeer = useCallback((key: string) => {
    const pc = peersRef.current.get(key)
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
      peersRef.current.delete(key)
    }
    pendingIceRef.current.delete(key)
    setRemoteStreams(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const createPeer = useCallback((peerKey: string): RTCPeerConnection => {
    let pc = peersRef.current.get(peerKey)
    if (pc) return pc
    pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current.set(peerKey, pc)

    const local = localStreamRef.current
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local)

    pc.onicecandidate = e => {
      if (e.candidate) {
        sendSignal({ from: self.key, to: peerKey, kind: 'ice', candidate: e.candidate.toJSON() })
      }
    }
    pc.ontrack = e => {
      const stream = e.streams[0]
      if (stream) setRemoteStreams(prev => ({ ...prev, [peerKey]: stream }))
    }
    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
        closePeer(peerKey)
      }
    }
    return pc
  }, [self.key, sendSignal, closePeer])

  const flushPendingIce = useCallback(async (peerKey: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerKey) ?? []
    pendingIceRef.current.delete(peerKey)
    for (const c of queued) {
      try { await pc.addIceCandidate(c) } catch { /* ignore stale candidates */ }
    }
  }, [])

  const handleSignal = useCallback(async (msg: SignalMsg) => {
    if (msg.to !== self.key) return
    if (msg.kind === 'offer' && msg.sdp) {
      const pc = createPeer(msg.from)
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
      await flushPendingIce(msg.from, pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal({ from: self.key, to: msg.from, kind: 'answer', sdp: answer.sdp })
    } else if (msg.kind === 'answer' && msg.sdp) {
      const pc = peersRef.current.get(msg.from)
      if (pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
        await flushPendingIce(msg.from, pc)
      }
    } else if (msg.kind === 'ice' && msg.candidate) {
      const pc = peersRef.current.get(msg.from)
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(msg.candidate) } catch { /* ignore */ }
      } else {
        const q = pendingIceRef.current.get(msg.from) ?? []
        q.push(msg.candidate)
        pendingIceRef.current.set(msg.from, q)
      }
    }
  }, [self.key, createPeer, sendSignal, flushPendingIce])

  // Deterministic initiator: for every peer present that we have no
  // connection to, the side with the lexicographically smaller key offers.
  const connectToPeers = useCallback(async (peerKeys: string[]) => {
    for (const peerKey of peerKeys) {
      if (peerKey === self.key || peersRef.current.has(peerKey)) continue
      if (self.key < peerKey) {
        const pc = createPeer(peerKey)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendSignal({ from: self.key, to: peerKey, kind: 'offer', sdp: offer.sdp })
      }
      // otherwise the other side will offer to us
    }
  }, [self.key, createPeer, sendSignal])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        localStreamRef.current = stream
      } catch {
        setStatus('error')
        setError('Немає доступу до мікрофона — дозволь його в браузері')
        return
      }

      const channel = supabase.channel(`voice-${roomKey}`, {
        config: { presence: { key: self.key }, broadcast: { self: false } },
      })
      channelRef.current = channel

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ name: string; color: string }>()
        const people: VoicePeerInfo[] = Object.entries(state).map(([key, metas]) => ({
          key,
          name: metas[0]?.name ?? '...',
          color: metas[0]?.color ?? '#14b8a6',
        }))
        setParticipants(people)
        connectToPeers(people.map(p => p.key))
        // Drop connections to people who left
        for (const key of [...peersRef.current.keys()]) {
          if (!people.some(p => p.key === key)) closePeer(key)
        }
      })

      channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
        handleSignal(payload as SignalMsg)
      })

      channel.subscribe(async s => {
        if (s === 'SUBSCRIBED') {
          await channel.track({ name: self.name, color: self.color })
          setStatus('live')
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('error')
          setError('Не вдалося підключитися до голосового каналу')
        }
      })
    })()

    return () => {
      cancelled = true
      for (const key of [...peersRef.current.keys()]) closePeer(key)
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, self.key])

  function toggleMute() {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !muted
    stream.getAudioTracks().forEach(t => { t.enabled = !next })
    setMuted(next)
  }

  // ── Invite others: ring their personal call-<key> channel ──────────────────
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteList, setInviteList] = useState<VoicePeerInfo[]>([])
  const [inviteSel, setInviteSel] = useState<Set<string>>(new Set())
  const [inviteSent, setInviteSent] = useState(false)

  useEffect(() => {
    if (!inviteOpen) return
    ;(async () => {
      const { data } = await supabase.from('team_members').select('id, name, color').order('name')
      const list: VoicePeerInfo[] = [
        { key: 'admin', name: 'Ivan (адмін)', color: '#0ea5e9' },
        ...((data ?? []) as { id: string; name: string; color: string }[])
          .map(m => ({ key: `team-${m.id}`, name: m.name, color: m.color || '#14b8a6' })),
      ]
      setInviteList(list.filter(p => p.key !== self.key))
    })()
  }, [inviteOpen, self.key])

  async function callSelected() {
    const keys = [...inviteSel].filter(k => !participants.some(p => p.key === k))
    for (const k of keys) {
      const ch = supabase.channel(`call-${k}`)
      await new Promise<void>(resolve => {
        ch.subscribe(s => { if (s === 'SUBSCRIBED') resolve() })
      })
      await ch.send({
        type: 'broadcast',
        event: 'ring',
        payload: { roomKey, roomName: roomName ?? 'Голосовий', from: self.name },
      })
      setTimeout(() => supabase.removeChannel(ch), 1500)
    }
    setInviteSel(new Set())
    setInviteSent(true)
    setTimeout(() => { setInviteSent(false); setInviteOpen(false) }, 1500)
  }

  return (
    <div className="relative px-4 py-2.5 border-b border-teal-100 bg-teal-50/70 flex items-center gap-3 flex-shrink-0">
      {status === 'connecting' && <Loader2 size={14} className="text-teal-500 animate-spin flex-shrink-0" />}
      {status === 'live' && <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse flex-shrink-0" />}

      <div className="flex items-center gap-1 min-w-0 flex-1">
        {status === 'error' ? (
          <p className="text-[11px] text-red-500 truncate">{error}</p>
        ) : (
          <>
            <div className="flex -space-x-1.5">
              {participants.map(p => (
                <span
                  key={p.key}
                  className="w-6 h-6 rounded-full ring-2 ring-white flex items-center justify-center text-white text-[9px] font-semibold"
                  style={{ backgroundColor: p.color }}
                  title={p.name}
                >
                  {p.name.charAt(0)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-teal-700 ml-2 truncate">
              {participants.length <= 1
                ? 'Ти в голосовому — чекаємо інших...'
                : participants.map(p => p.name).join(', ')}
            </p>
          </>
        )}
      </div>

      {status === 'live' && (
        <button
          onClick={() => setInviteOpen(v => !v)}
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 border ${
            inviteOpen ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
          }`}
          title="Запросити в голосовий"
        >
          <UserPlus size={13} />
        </button>
      )}

      {/* Invite picker */}
      {inviteOpen && (
        <div className="absolute top-full right-2 mt-1 z-50 w-60 bg-white border border-gray-200 rounded-xl shadow-xl p-2">
          {inviteSent ? (
            <p className="flex items-center gap-1.5 text-xs text-teal-600 font-medium px-2 py-2">
              <Check size={13} /> Виклик надіслано
            </p>
          ) : (
            <>
              <p className="text-[10px] text-gray-400 font-semibold uppercase px-2 pt-1 pb-1.5">Кого запросити</p>
              <div className="max-h-44 overflow-y-auto flex flex-col">
                {inviteList
                  .filter(p => !participants.some(x => x.key === p.key))
                  .map(p => (
                    <label key={p.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={inviteSel.has(p.key)}
                        onChange={() => setInviteSel(prev => {
                          const next = new Set(prev)
                          if (next.has(p.key)) next.delete(p.key)
                          else next.add(p.key)
                          return next
                        })}
                        className="accent-teal-500"
                      />
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold flex-shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name.charAt(0)}
                      </span>
                      {p.name}
                    </label>
                  ))}
                {inviteList.filter(p => !participants.some(x => x.key === p.key)).length === 0 && (
                  <p className="text-[11px] text-gray-300 px-2 py-2">Всі вже тут 🎉</p>
                )}
              </div>
              <button
                onClick={callSelected}
                disabled={inviteSel.size === 0}
                className="w-full mt-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
              >
                Подзвонити
              </button>
            </>
          )}
        </div>
      )}

      {status !== 'error' && (
        <button
          onClick={toggleMute}
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
            muted ? 'bg-red-100 text-red-500 hover:bg-red-200' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
          title={muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
        >
          {muted ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      )}
      <button
        onClick={onLeave}
        className="bg-red-500 hover:bg-red-600 text-white p-1.5 rounded-lg transition-colors flex-shrink-0"
        title="Вийти з голосового"
      >
        <PhoneOff size={13} />
      </button>

      {/* Hidden audio sinks for every remote participant */}
      {Object.entries(remoteStreams).map(([key, stream]) => (
        <RemoteAudio key={key} stream={stream} />
      ))}
    </div>
  )
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay className="hidden" />
}
