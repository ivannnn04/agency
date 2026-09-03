'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Mic, MicOff, PhoneOff, Loader2, UserPlus, Check, Monitor, MonitorOff, Minimize2, Maximize2, Video, VideoOff, SmilePlus } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getAdminProfile } from '@/lib/adminProfile'

// Live voice room (Discord-style): WebRTC mesh audio + screen share between
// participants, Supabase Realtime as signaling (presence = who's here,
// broadcast = offer/answer/ICE). Team + admin only.
//
// variant 'bar'   — compact strip (floating panel / chat header)
// variant 'modal' — big centered call window (direct calls)
// ringKeys        — auto-ring these people once the room is live

export interface VoicePeerInfo {
  key: string   // unique id: 'admin' or 'team-<id>'
  name: string
  color: string
}

interface SignalMsg {
  from: string
  to: string
  kind: 'offer' | 'answer' | 'ice'
  sdp?: string
  candidate?: RTCIceCandidateInit
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export default function VoiceRoom({ roomKey, roomName, self, onLeave, onMinimize, variant = 'bar', ringKeys }: {
  roomKey: string
  roomName?: string
  self: VoicePeerInfo
  onLeave: () => void
  onMinimize?: () => void
  variant?: 'bar' | 'modal'
  ringKeys?: string[]
}) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [participants, setParticipants] = useState<VoicePeerInfo[]>([])
  const [remoteAudio, setRemoteAudio] = useState<Record<string, MediaStream>>({})
  // Video tiles keyed by stream id — a peer can send camera AND screen
  const [remoteVideo, setRemoteVideo] = useState<Record<string, { peer: string; stream: MediaStream }>>({})
  const [localCam, setLocalCam] = useState<MediaStream | null>(null)
  // Google-Meet-style floating reactions
  const [reactions, setReactions] = useState<{ id: number; emoji: string; name: string }[]>([])

  const channelRef = useRef<RealtimeChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const rangRef = useRef(false)

  const addReaction = useCallback((emoji: string, name: string) => {
    const id = Date.now() + Math.random()
    setReactions(prev => [...prev.slice(-5), { id, emoji, name }])
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3200)
  }, [])

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
    setRemoteAudio(prev => { const n = { ...prev }; delete n[key]; return n })
    setRemoteVideo(prev => {
      const n = { ...prev }
      for (const sid of Object.keys(n)) if (n[sid].peer === key) delete n[sid]
      return n
    })
  }, [])

  const renegotiate = useCallback(async (peerKey: string, pc: RTCPeerConnection) => {
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendSignal({ from: self.key, to: peerKey, kind: 'offer', sdp: offer.sdp })
    } catch { /* transient state — the next sync will retry */ }
  }, [self.key, sendSignal])

  const createPeer = useCallback((peerKey: string): RTCPeerConnection => {
    let pc = peersRef.current.get(peerKey)
    if (pc) return pc
    pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current.set(peerKey, pc)

    const local = localStreamRef.current
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local)
    const screen = screenStreamRef.current
    if (screen) for (const track of screen.getTracks()) pc.addTrack(track, screen)
    const cam = camStreamRef.current
    if (cam) for (const track of cam.getTracks()) pc.addTrack(track, cam)

    pc.onicecandidate = e => {
      if (e.candidate) {
        sendSignal({ from: self.key, to: peerKey, kind: 'ice', candidate: e.candidate.toJSON() })
      }
    }
    pc.ontrack = e => {
      const stream = e.streams[0]
      if (!stream) return
      if (e.track.kind === 'video') {
        const sid = stream.id
        setRemoteVideo(prev => ({ ...prev, [sid]: { peer: peerKey, stream } }))
        const drop = () => setRemoteVideo(prev => { const n = { ...prev }; delete n[sid]; return n })
        e.track.onended = drop
        stream.onremovetrack = () => { if (stream.getVideoTracks().length === 0) drop() }
      } else {
        setRemoteAudio(prev => ({ ...prev, [peerKey]: stream }))
      }
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
      try { await pc.addIceCandidate(c) } catch { /* stale */ }
    }
  }, [])

  const handleSignal = useCallback(async (msg: SignalMsg) => {
    if (msg.to !== self.key) return
    try {
      if (msg.kind === 'offer' && msg.sdp) {
        const pc = createPeer(msg.from)
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
        await flushPendingIce(msg.from, pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ from: self.key, to: msg.from, kind: 'answer', sdp: answer.sdp })
      } else if (msg.kind === 'answer' && msg.sdp) {
        const pc = peersRef.current.get(msg.from)
        if (pc && pc.signalingState === 'have-local-offer') {
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
    } catch { /* renegotiation glare — the initiator retries on next change */ }
  }, [self.key, createPeer, sendSignal, flushPendingIce])

  // Deterministic initiator: the side with the smaller key offers.
  const connectToPeers = useCallback(async (peerKeys: string[]) => {
    for (const peerKey of peerKeys) {
      if (peerKey === self.key || peersRef.current.has(peerKey)) continue
      if (self.key < peerKey) {
        const pc = createPeer(peerKey)
        await renegotiate(peerKey, pc)
      }
    }
  }, [self.key, createPeer, renegotiate])

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
        for (const key of [...peersRef.current.keys()]) {
          if (!people.some(p => p.key === key)) closePeer(key)
        }
      })

      channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
        handleSignal(payload as SignalMsg)
      })

      channel.on('broadcast', { event: 'reaction' }, ({ payload }) => {
        const r = payload as { emoji: string; name: string }
        if (r?.emoji) addReaction(r.emoji, r.name ?? '')
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
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      camStreamRef.current?.getTracks().forEach(t => t.stop())
      camStreamRef.current = null
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, self.key])

  // ── Ringing people (outgoing call / invite picker) ──────────────────────────

  const ringPeers = useCallback(async (keys: string[]) => {
    for (const k of keys) {
      if (k === self.key) continue
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
  }, [roomKey, roomName, self.key, self.name])

  // Outgoing direct call: ring the peer(s) as soon as we're live
  useEffect(() => {
    if (status !== 'live' || rangRef.current || !ringKeys || ringKeys.length === 0) return
    rangRef.current = true
    ringPeers(ringKeys)
  }, [status, ringKeys, ringPeers])

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteList, setInviteList] = useState<VoicePeerInfo[]>([])
  const [inviteSel, setInviteSel] = useState<Set<string>>(new Set())
  const [inviteSent, setInviteSent] = useState(false)

  useEffect(() => {
    if (!inviteOpen) return
    ;(async () => {
      const { data } = await supabase.from('team_members').select('id, name, color').order('name')
      const admin = await getAdminProfile()
      const list: VoicePeerInfo[] = [
        { key: 'admin', name: `${admin.name} (адмін)`, color: '#0ea5e9' },
        ...((data ?? []) as { id: string; name: string; color: string }[])
          .map(m => ({ key: `team-${m.id}`, name: m.name, color: m.color || '#14b8a6' })),
      ]
      setInviteList(list.filter(p => p.key !== self.key))
    })()
  }, [inviteOpen, self.key])

  async function callSelected() {
    const keys = [...inviteSel].filter(k => !participants.some(p => p.key === k))
    await ringPeers(keys)
    setInviteSel(new Set())
    setInviteSent(true)
    setTimeout(() => { setInviteSent(false); setInviteOpen(false) }, 1500)
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  function toggleMute() {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !muted
    stream.getAudioTracks().forEach(t => { t.enabled = !next })
    setMuted(next)
  }

  async function startShare() {
    if (sharing) { stopShare(); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = stream
      setSharing(true)
      const track = stream.getVideoTracks()[0]
      if (track) track.onended = () => stopShare()
      for (const [key, pc] of peersRef.current) {
        for (const t of stream.getTracks()) pc.addTrack(t, stream)
        renegotiate(key, pc)
      }
    } catch { /* user cancelled the picker */ }
  }

  function stopShare() {
    const stream = screenStreamRef.current
    if (!stream) { setSharing(false); return }
    const ids = new Set(stream.getTracks().map(t => t.id))
    for (const [key, pc] of peersRef.current) {
      for (const sender of pc.getSenders()) {
        if (sender.track && ids.has(sender.track.id)) pc.removeTrack(sender)
      }
      renegotiate(key, pc)
    }
    stream.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    setSharing(false)
  }

  // ── Camera ──────────────────────────────────────────────────────────────────

  async function toggleCam() {
    if (camOn) { stopCam(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      })
      camStreamRef.current = stream
      setLocalCam(stream)
      setCamOn(true)
      const track = stream.getVideoTracks()[0]
      if (track) track.onended = () => stopCam()
      for (const [key, pc] of peersRef.current) {
        for (const t of stream.getTracks()) pc.addTrack(t, stream)
        renegotiate(key, pc)
      }
    } catch { /* camera denied */ }
  }

  function stopCam() {
    const stream = camStreamRef.current
    if (!stream) { setCamOn(false); setLocalCam(null); return }
    const ids = new Set(stream.getTracks().map(t => t.id))
    for (const [key, pc] of peersRef.current) {
      for (const sender of pc.getSenders()) {
        if (sender.track && ids.has(sender.track.id)) pc.removeTrack(sender)
      }
      renegotiate(key, pc)
    }
    stream.getTracks().forEach(t => t.stop())
    camStreamRef.current = null
    setLocalCam(null)
    setCamOn(false)
  }

  // ── Meet-style reactions ────────────────────────────────────────────────────

  const CALL_REACTIONS = ['👍', '👎', '🖕', '💩', '❤️', '😂', '😮', '🎉', '👏']
  const [reactOpen, setReactOpen] = useState(false)

  function sendReaction(emoji: string) {
    channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { emoji, name: self.name } })
    addReaction(emoji, self.name)
    setReactOpen(false)
  }

  // ── Shared UI pieces ────────────────────────────────────────────────────────

  const audioSinks = Object.entries(remoteAudio).map(([key, stream]) => (
    <RemoteMedia key={`a-${key}`} stream={stream} kind="audio" />
  ))

  const videoTileCount = Object.keys(remoteVideo).length + (localCam ? 1 : 0)
  const videoArea = videoTileCount > 0 && (
    <div className={`grid gap-1 bg-black ${videoTileCount > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {Object.entries(remoteVideo).map(([sid, v]) => (
        <RemoteMedia
          key={`v-${sid}`}
          stream={v.stream}
          kind="video"
          label={participants.find(p => p.key === v.peer)?.name}
        />
      ))}
      {localCam && <RemoteMedia stream={localCam} kind="video" muted mirrored label="Ти" />}
    </div>
  )

  const reactionOverlay = reactions.length > 0 && (
    <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 z-[85] flex flex-col items-center gap-1">
      {reactions.map(r => (
        <div key={r.id} className="flex items-center gap-1.5 bg-black/60 text-white rounded-full px-3 py-1 animate-bounce">
          <span className="text-xl leading-none">{r.emoji}</span>
          <span className="text-[10px] font-medium">{r.name}</span>
        </div>
      ))}
    </div>
  )

  const reactPicker = reactOpen && (
    <div className={variant === 'modal'
      ? 'flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1.5'
      : 'absolute bottom-full right-2 mb-1 z-50 flex items-center gap-1 bg-white border border-gray-200 rounded-full shadow-xl px-2 py-1.5'}
    >
      {CALL_REACTIONS.map(e => (
        <button
          key={e}
          onClick={() => sendReaction(e)}
          className="text-lg leading-none hover:scale-125 transition-transform p-0.5"
        >
          {e}
        </button>
      ))}
    </div>
  )

  const invitePanel = inviteOpen && (
    <div className={variant === 'modal'
      ? 'w-full bg-gray-50 rounded-xl p-2 mt-3'
      : 'absolute top-full right-2 mt-1 z-50 w-60 bg-white border border-gray-200 rounded-xl shadow-xl p-2'}
    >
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
                <label key={p.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:bg-white rounded-lg px-2 py-1.5">
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
  )

  // ── Modal variant: big call window ──────────────────────────────────────────

  if (variant === 'modal') {
    const alone = participants.length <= 1
    return (
      <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col">
          {reactionOverlay}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-800 truncate">📞 {roomName ?? 'Дзвінок'}</p>
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                title="Згорнути (дзвінок триває)"
              >
                <Minimize2 size={15} />
              </button>
            )}
          </div>

          {videoArea && <div className="max-h-[45vh] overflow-hidden">{videoArea}</div>}

          <div className="px-6 py-6 flex flex-col items-center gap-4">
            {status === 'error' ? (
              <p className="text-sm text-red-500 text-center">{error}</p>
            ) : (
              <>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  {participants.map(p => (
                    <div key={p.key} className="flex flex-col items-center gap-1.5">
                      <span
                        className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold ${
                          alone ? 'animate-pulse' : ''
                        }`}
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name.charAt(0)}
                      </span>
                      <span className="text-xs text-gray-600 font-medium max-w-[90px] truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-400">
                  {status === 'connecting'
                    ? 'Підключення...'
                    : alone
                      ? (ringKeys && ringKeys.length > 0 ? 'Дзвонимо... 🔔' : 'Чекаємо інших...')
                      : 'У розмові'}
                </p>
              </>
            )}

            {reactPicker}
            <div className="flex items-center gap-3 mt-1">
              {status === 'live' && (
                <>
                  <button
                    onClick={() => setInviteOpen(v => !v)}
                    className={`p-3 rounded-full transition-colors border ${
                      inviteOpen ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
                    }`}
                    title="Запросити ще"
                  >
                    <UserPlus size={17} />
                  </button>
                  <button
                    onClick={startShare}
                    className={`p-3 rounded-full transition-colors border ${
                      sharing ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
                    }`}
                    title={sharing ? 'Зупинити демонстрацію' : 'Демонстрація екрана'}
                  >
                    {sharing ? <MonitorOff size={17} /> : <Monitor size={17} />}
                  </button>
                  <button
                    onClick={toggleCam}
                    className={`p-3 rounded-full transition-colors border ${
                      camOn ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
                    }`}
                    title={camOn ? 'Вимкнути камеру' : 'Увімкнути камеру'}
                  >
                    {camOn ? <VideoOff size={17} /> : <Video size={17} />}
                  </button>
                  <button
                    onClick={() => setReactOpen(v => !v)}
                    className={`p-3 rounded-full transition-colors border ${
                      reactOpen ? 'bg-amber-400 text-white border-amber-400' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
                    }`}
                    title="Реакція"
                  >
                    <SmilePlus size={17} />
                  </button>
                  <button
                    onClick={toggleMute}
                    className={`p-3 rounded-full transition-colors border ${
                      muted ? 'bg-red-100 text-red-500 border-red-200' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
                    }`}
                    title={muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
                  >
                    {muted ? <MicOff size={17} /> : <Mic size={17} />}
                  </button>
                </>
              )}
              <button
                onClick={onLeave}
                className="bg-red-500 hover:bg-red-600 text-white p-3 rounded-full transition-colors"
                title="Завершити дзвінок"
              >
                <PhoneOff size={17} />
              </button>
            </div>

            {invitePanel}
          </div>
          {audioSinks}
        </div>
      </div>
    )
  }

  // ── Bar variant ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
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
          <>
            <button
              onClick={() => setInviteOpen(v => !v)}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 border ${
                inviteOpen ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
              }`}
              title="Запросити в голосовий"
            >
              <UserPlus size={13} />
            </button>
            <button
              onClick={startShare}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 border ${
                sharing ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
              }`}
              title={sharing ? 'Зупинити демонстрацію' : 'Демонстрація екрана'}
            >
              {sharing ? <MonitorOff size={13} /> : <Monitor size={13} />}
            </button>
            <button
              onClick={toggleCam}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 border ${
                camOn ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
              }`}
              title={camOn ? 'Вимкнути камеру' : 'Увімкнути камеру'}
            >
              {camOn ? <VideoOff size={13} /> : <Video size={13} />}
            </button>
            <button
              onClick={() => setReactOpen(v => !v)}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 border ${
                reactOpen ? 'bg-amber-400 text-white border-amber-400' : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-200'
              }`}
              title="Реакція"
            >
              <SmilePlus size={13} />
            </button>
          </>
        )}

        {invitePanel}
        {reactPicker}
        {reactionOverlay}

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

        {audioSinks}
      </div>
      {videoArea}
    </div>
  )
}

function RemoteMedia({ stream, kind, muted, mirrored, label }: {
  stream: MediaStream
  kind: 'audio' | 'video'
  muted?: boolean
  mirrored?: boolean
  label?: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (kind === 'audio' && audioRef.current) audioRef.current.srcObject = stream
    if (kind === 'video' && videoRef.current) videoRef.current.srcObject = stream
  }, [stream, kind])
  if (kind === 'audio') return <audio ref={audioRef} autoPlay className="hidden" />

  function goFullscreen() {
    const el = videoRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }

  return (
    <div className="relative group/video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        onDoubleClick={goFullscreen}
        className="w-full max-h-[45vh] object-contain bg-black cursor-zoom-in"
        style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
        title="Подвійний клік — на весь екран"
      />
      {label && (
        <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          {label}
        </span>
      )}
      <button
        onClick={goFullscreen}
        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded-lg opacity-0 group-hover/video:opacity-100 transition-opacity"
        title="На весь екран"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  )
}
