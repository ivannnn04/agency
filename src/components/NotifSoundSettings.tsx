'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2, Play, Check } from 'lucide-react'
import {
  NOTIF_SOUNDS, getNotifPrefs, saveNotifPrefs, loadNotifPrefs, playNotifSound,
} from '@/lib/notifSound'

// Per-account notification sound: pick one of the built-in sounds and set
// the volume. Saved to the account (admin_profile / team_members) so the
// choice follows the person to any device.
export default function NotifSoundSettings({ userKey }: { userKey: string }) {
  const [sound, setSound] = useState('ping')
  const [volume, setVolume] = useState(70)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      await loadNotifPrefs(userKey)
      const p = getNotifPrefs()
      setSound(p.sound)
      setVolume(p.volume)
    })()
  }, [userKey])

  function persist(nextSound: string, nextVolume: number) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const err = await saveNotifPrefs(userKey, { sound: nextSound, volume: nextVolume })
      if (err) {
        setError(err.includes('notif_sound') || err.includes('column')
          ? 'Запусти міграцію notif_sound_migration.sql — поки що вибір збережено лише в цьому браузері'
          : err)
      } else {
        setError('')
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      }
    }, 400)
  }

  function pickSound(id: string) {
    setSound(id)
    playNotifSound(id, volume)
    persist(id, volume)
  }

  function changeVolume(v: number) {
    setVolume(v)
    persist(sound, v)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-900">Звук сповіщень</p>
        {saved && <span className="flex items-center gap-1 text-[11px] text-teal-600"><Check size={12} /> Збережено</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {NOTIF_SOUNDS.map(s => (
          <button
            key={s.id}
            onClick={() => pickSound(s.id)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors text-left ${
              sound === s.id
                ? 'bg-teal-50 text-teal-700 border-teal-300'
                : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <Play size={11} className="flex-shrink-0" />
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Volume2 size={15} className="text-gray-400 flex-shrink-0" />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={e => changeVolume(Number(e.target.value))}
          onMouseUp={() => playNotifSound(sound, volume)}
          onTouchEnd={() => playNotifSound(sound, volume)}
          className="flex-1 accent-teal-500"
        />
        <span className="text-xs text-gray-500 w-9 text-right">{volume}%</span>
      </div>
      {volume === 0 && <p className="text-[11px] text-amber-600 mt-1.5">Гучність 0 — звуку не буде, лишаться тільки бейджі й пуші</p>}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  )
}
