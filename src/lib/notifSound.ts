'use client'

import { supabase } from '@/lib/supabase'

// Notification sounds: a small set of Web Audio-synthesized pings plus a
// per-account preference (which sound + how loud). The preference lives in
// the DB (admin_profile / team_members) so it follows the account, and is
// mirrored to localStorage so playback never waits on a query.

export interface NotifPrefs {
  sound: string
  volume: number // 0..100
}

export const NOTIF_SOUNDS: { id: string; name: string }[] = [
  { id: 'ping', name: 'Пінг (класика)' },
  { id: 'bell', name: 'Дзвіночок' },
  { id: 'chime', name: 'Передзвін' },
  { id: 'pop', name: 'Поп' },
  { id: 'knock', name: 'Тук-тук' },
  { id: 'drop', name: 'Крапля' },
]

const DEFAULT_PREFS: NotifPrefs = { sound: 'ping', volume: 70 }
const LS_KEY = 'gudrix:notifPrefs'

export function getNotifPrefs(): NotifPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw)
    return {
      sound: NOTIF_SOUNDS.some(s => s.id === p.sound) ? p.sound : DEFAULT_PREFS.sound,
      volume: Math.min(100, Math.max(0, Number(p.volume ?? DEFAULT_PREFS.volume))),
    }
  } catch { return DEFAULT_PREFS }
}

export function cacheNotifPrefs(p: NotifPrefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

// DB → localStorage on app load, so a member's choice follows them to any device
export async function loadNotifPrefs(userKey: string) {
  try {
    const q = userKey === 'admin'
      ? supabase.from('admin_profile').select('notif_sound, notif_volume').eq('id', 'main').maybeSingle()
      : supabase.from('team_members').select('notif_sound, notif_volume').eq('id', userKey.replace('team-', '')).maybeSingle()
    const { data } = await q
    if (data && (data.notif_sound || data.notif_volume != null)) {
      cacheNotifPrefs({
        sound: data.notif_sound ?? DEFAULT_PREFS.sound,
        volume: data.notif_volume ?? DEFAULT_PREFS.volume,
      })
    }
  } catch { /* columns not migrated yet — localStorage keeps working */ }
}

export async function saveNotifPrefs(userKey: string, p: NotifPrefs): Promise<string | null> {
  cacheNotifPrefs(p)
  const patch = { notif_sound: p.sound, notif_volume: p.volume }
  const { error } = userKey === 'admin'
    ? await supabase.from('admin_profile').update(patch).eq('id', 'main')
    : await supabase.from('team_members').update(patch).eq('id', userKey.replace('team-', ''))
  return error ? error.message : null
}

// ── Playback ───────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null
let audioPrimed = false

// Browsers keep audio locked until the first user gesture
export function primeAudio() {
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

function tone(
  ctx: AudioContext, master: GainNode,
  opts: { freq: number; at: number; dur: number; peak: number; type?: OscillatorType; glideTo?: number },
) {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(opts.freq, now + opts.at)
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, now + opts.at + opts.dur)
  gain.gain.setValueAtTime(0.0001, now + opts.at)
  gain.gain.exponentialRampToValueAtTime(opts.peak, now + opts.at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.at + opts.dur)
  osc.connect(gain)
  gain.connect(master)
  osc.start(now + opts.at)
  osc.stop(now + opts.at + opts.dur + 0.05)
}

export function playNotifSound(soundId?: string, volume?: number) {
  try {
    const prefs = getNotifPrefs()
    const id = soundId ?? prefs.sound
    const vol = (volume ?? prefs.volume) / 100
    if (vol <= 0) return
    audioCtx = audioCtx ?? new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const master = ctx.createGain()
    // 70% slider ≈ the loudness the app always had
    master.gain.value = vol / 0.7
    master.connect(ctx.destination)

    switch (id) {
      case 'bell':
        tone(ctx, master, { freq: 880, at: 0, dur: 0.7, peak: 0.14 })
        tone(ctx, master, { freq: 1760, at: 0, dur: 0.45, peak: 0.05 })
        break
      case 'chime':
        tone(ctx, master, { freq: 523, at: 0, dur: 0.25, peak: 0.12 })
        tone(ctx, master, { freq: 659, at: 0.12, dur: 0.25, peak: 0.12 })
        tone(ctx, master, { freq: 784, at: 0.24, dur: 0.4, peak: 0.12 })
        break
      case 'pop':
        tone(ctx, master, { freq: 420, at: 0, dur: 0.12, peak: 0.2, type: 'triangle', glideTo: 300 })
        break
      case 'knock':
        tone(ctx, master, { freq: 175, at: 0, dur: 0.09, peak: 0.3, type: 'sine' })
        tone(ctx, master, { freq: 165, at: 0.16, dur: 0.09, peak: 0.3, type: 'sine' })
        break
      case 'drop':
        tone(ctx, master, { freq: 900, at: 0, dur: 0.3, peak: 0.14, glideTo: 350 })
        break
      case 'ping':
      default:
        tone(ctx, master, { freq: 739, at: 0, dur: 0.28, peak: 0.16 })
        tone(ctx, master, { freq: 555, at: 0.13, dur: 0.28, peak: 0.16 })
    }
  } catch { /* audio blocked until first gesture — fine */ }
}
