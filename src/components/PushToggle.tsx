'use client'

import { useEffect, useState } from 'react'
import { BellRing, BellOff, Loader2 } from 'lucide-react'
import { enablePush, disablePush, pushEnabled, pushSupported } from '@/lib/pushClient'

// Per-device switch for phone/desktop push notifications. Lives on the
// profile pages (admin and team).
export default function PushToggle({ userKey }: { userKey: string }) {
  const [supported, setSupported] = useState(true)
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setSupported(pushSupported())
    setOn(pushEnabled())
  }, [])

  async function toggle() {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        const res = await enablePush(userKey)
        if (res === 'ok') setOn(true)
        else if (res === 'denied') setMsg('Дозвіл на сповіщення заблоковано — увімкни його в налаштуваннях браузера для цього сайту')
        else setMsg('Цей браузер не підтримує пуш-сповіщення')
      }
    } catch {
      setMsg('Щось пішло не так — спробуй ще раз')
    }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Сповіщення на цьому пристрої</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Пуші про повідомлення й задачі, навіть коли сайт закритий.
            На iPhone спершу додай апку на початковий екран.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || !supported}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors flex-shrink-0 ${
            on
              ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
              : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
          } disabled:opacity-40`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : on ? <BellRing size={14} /> : <BellOff size={14} />}
          {on ? 'Увімкнено' : 'Увімкнути'}
        </button>
      </div>
      {!supported && (
        <p className="text-xs text-amber-600 mt-2">
          Браузер не підтримує пуші. На iPhone: Safari → Поділитися → «На початковий екран», далі відкрий апку звідти.
        </p>
      )}
      {msg && <p className="text-xs text-red-500 mt-2">{msg}</p>}
    </div>
  )
}
