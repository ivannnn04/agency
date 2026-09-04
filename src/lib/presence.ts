'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// App-wide online presence over one Supabase Realtime channel.
// Internal users (admin + team) track themselves via startPresence (called
// from the global CallListener); any component can read who's online with
// useOnlineUsers(). Keys: 'admin' | 'team-<id>'.

let ch: RealtimeChannel | null = null
let chKey = ''
let selfMeta: { name: string } | null = null
let online: Record<string, string> = {} // key -> name
const subs = new Set<() => void>()

function build(key: string) {
  if (ch) supabase.removeChannel(ch)
  chKey = key
  const channel = supabase.channel('online-users', { config: { presence: { key } } })
  ch = channel
  channel.on('presence', { event: 'sync' }, () => {
    const st = channel.presenceState<{ name: string }>()
    online = {}
    for (const [k, metas] of Object.entries(st)) {
      if (!k.startsWith('viewer-')) online[k] = metas[0]?.name ?? ''
    }
    subs.forEach(f => f())
  })
  channel.subscribe(async s => {
    if (s === 'SUBSCRIBED' && selfMeta && !key.startsWith('viewer-')) {
      await channel.track(selfMeta)
    }
  })
}

// Announce that the current user is online (survives page navigation while
// the layout stays mounted; the channel drops automatically on tab close).
export function startPresence(key: string, name: string) {
  selfMeta = { name }
  if (chKey !== key) build(key)
}

function ensureChannel() {
  if (!ch) build(`viewer-${Math.random().toString(36).slice(2)}`)
}

// key -> display name of everyone currently online
export function useOnlineUsers(): Record<string, string> {
  const [state, setState] = useState(online)
  useEffect(() => {
    ensureChannel()
    const f = () => setState({ ...online })
    f()
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return state
}
