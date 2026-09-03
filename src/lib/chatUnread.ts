'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// Per-browser read state: localStorage keeps the last-read timestamp for every
// project/channel pair. Unread = any foreign message newer than that mark.

export interface ChannelUnread {
  team: boolean      // unread in the team channel
  client: boolean    // unread in the client channel (anyone)
  clientNew: boolean // unread message written BY the client — "клієнт пише"
  teamCount: number   // exact unread count, team channel
  clientCount: number // exact unread count, client channel
}

const readKey = (projectId: string, channel: string) => `chatRead:${projectId}:${channel}`

export function getLastRead(projectId: string, channel: string): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(readKey(projectId, channel)) ?? ''
}

export function markRead(projectId: string, channel: string) {
  localStorage.setItem(readKey(projectId, channel), new Date().toISOString())
  window.dispatchEvent(new Event('gudrix:chat-read'))
}

// Slack-style two-tone ping via Web Audio (no asset files needed).
let audioCtx: AudioContext | null = null

// Browsers keep audio locked until the first user gesture. Priming the
// context on the first click/keypress lets later pings actually sound.
let audioPrimed = false
function primeAudio() {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    audioPrimed = true
  } catch { /* unavailable */ }
}
if (typeof window !== 'undefined' && !audioPrimed) {
  window.addEventListener('pointerdown', primeAudio, { once: true })
  window.addEventListener('keydown', primeAudio, { once: true })
}

export function playChatPing() {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const now = ctx.currentTime
    // A whole tone below the original 830/623 Hz pair
    const notes: [number, number][] = [[739, 0], [555, 0.13]]
    for (const [freq, off] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + off)
      gain.gain.exponentialRampToValueAtTime(0.16, now + off + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + off)
      osc.stop(now + off + 0.32)
    }
  } catch {
    // AudioContext unavailable or blocked until first user gesture — fine
  }
}

interface MsgRow {
  id: string
  project_id: string | null
  chat_id?: string | null
  dm_key?: string | null
  channel: 'team' | 'client'
  sender_type: 'admin' | 'team' | 'client' | 'bot'
  team_member_id: string | null
  created_at: string
}

// Polls recent chat messages and returns unread flags per project.
// self: who is watching (their own messages never count as unread).
// projectId: limit to one project (board pages); omit for the whole app (sidebar).
// sound: play a ping when a NEW foreign message arrives while the app is open.
export function useChatUnread(opts: {
  self: 'admin' | 'team'
  memberId?: string | null
  projectId?: string
  sound?: boolean
  intervalMs?: number
}) {
  const { self, memberId, projectId, sound, intervalMs } = opts
  const [unread, setUnread] = useState<Record<string, ChannelUnread>>({})
  const newestSeenRef = useRef<string | null>(null)
  const firstLoadRef = useRef(true)

  const poll = useCallback(async () => {
    // chat_id may not exist before the general_chats migration — fall back
    let q = supabase
      .from('project_messages')
      .select('id, project_id, chat_id, dm_key, channel, sender_type, team_member_id, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
    if (projectId) q = q.eq('project_id', projectId)
    const res = await q
    let rows: MsgRow[] | null = res.data as MsgRow[] | null
    if (!rows) {
      let q2 = supabase
        .from('project_messages')
        .select('id, project_id, channel, sender_type, team_member_id, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (projectId) q2 = q2.eq('project_id', projectId)
      const res2 = await q2
      rows = res2.data as MsgRow[] | null
    }
    if (!rows) return
    // Bot messages are sent on the admin's approval, so they're "own" for the admin
    const isOwn = (m: MsgRow) =>
      self === 'admin'
        ? m.sender_type === 'admin' || m.sender_type === 'bot'
        : m.sender_type === 'team' && m.team_member_id === (memberId ?? null)

    const nowIso = new Date().toISOString()
    const map: Record<string, ChannelUnread> = {}
    let newestForeign: string | null = null

    const selfKey = self === 'admin' ? 'admin' : `team-${memberId}`

    for (const m of rows) {
      if (isOwn(m)) continue
      // Direct messages: only count conversations that involve ME
      if (m.dm_key && !m.dm_key.split('|').includes(selfKey)) continue
      // Key: projects by id, general chats "chat:<id>", DMs "dm:<pair>"
      const key = m.project_id
        ?? (m.chat_id ? `chat:${m.chat_id}` : null)
        ?? (m.dm_key ? `dm:${m.dm_key}` : null)
      if (!key) continue
      if (!newestForeign || m.created_at > newestForeign) newestForeign = m.created_at

      let lastRead = getLastRead(key, m.channel)
      if (!lastRead) {
        // First run in this browser: treat history as read, count only future messages
        localStorage.setItem(readKey(key, m.channel), nowIso)
        lastRead = nowIso
      }
      if (m.created_at > lastRead) {
        const u = map[key] ?? (map[key] = { team: false, client: false, clientNew: false, teamCount: 0, clientCount: 0 })
        if (m.channel === 'team') { u.team = true; u.teamCount++ }
        else {
          u.client = true
          u.clientCount++
          if (m.sender_type === 'client') u.clientNew = true
        }
      }
    }

    setUnread(map)

    if (
      sound &&
      !firstLoadRef.current &&
      newestForeign &&
      newestSeenRef.current &&
      newestForeign > newestSeenRef.current
    ) {
      playChatPing()
    }
    if (newestForeign) newestSeenRef.current = newestForeign
    firstLoadRef.current = false
  }, [self, memberId, projectId, sound])

  useEffect(() => {
    poll()
    const iv = setInterval(poll, intervalMs ?? 12000)
    const onRead = () => poll()
    window.addEventListener('gudrix:chat-read', onRead)
    return () => {
      clearInterval(iv)
      window.removeEventListener('gudrix:chat-read', onRead)
    }
  }, [poll, intervalMs])

  return unread
}
