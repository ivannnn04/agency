'use client'

import { useState } from 'react'
import { CalendarDays, Clock } from 'lucide-react'
import { PortalLang, PortalText, portalLocale } from '@/lib/portalI18n'

// The client's "Tracked hours" tab: day by day, which tasks were worked on
// and for how long. Only the date and the amount of time — never the hours
// of the day the work happened. Each bar is as long as its share of the
// longest piece of work in the list, so days compare at a glance.

export interface TrackedDay { day: string; tasks: { task_id: string; seconds: number }[] }

const PAGE = 14

function hours(seconds: number, lang: PortalLang): string {
  const [hh, mm] = lang === 'uk' ? [' год', ' хв'] : ['h', 'm']
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${Math.max(1, m)}${mm}`
  return m > 0 ? `${h}${hh} ${m}${mm}` : `${h}${hh}`
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function PortalHours({ days, titles, t, lang }: {
  days: TrackedDay[]
  titles: Record<string, string>
  t: PortalText
  lang: PortalLang
}) {
  const [shown, setShown] = useState(PAGE)
  const locale = portalLocale(lang)

  const today = new Date()
  const todayIso = iso(today)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const yesterdayIso = iso(yesterday)
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const mondayIso = iso(monday)

  const dayTotal = (d: TrackedDay) => d.tasks.reduce((s, x) => s + x.seconds, 0)
  const total = days.reduce((s, d) => s + dayTotal(d), 0)
  const week = days.filter(d => d.day >= mondayIso).reduce((s, d) => s + dayTotal(d), 0)
  const longest = Math.max(1, ...days.flatMap(d => d.tasks.map(x => x.seconds)))

  const label = (day: string) => {
    const date = new Date(day + 'T00:00:00')
    const full = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
    const text = full.charAt(0).toUpperCase() + full.slice(1)
    return day === todayIso ? `${t.hoursToday} · ${text}` : day === yesterdayIso ? `${t.hoursYesterday} · ${text}` : text
  }

  return (
    <div className="px-5 sm:px-8 lg:px-12 py-8 flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3 sm:gap-5">
        {[
          { label: t.hoursTotal, value: total > 0 ? hours(total, lang) : '—' },
          { label: t.hoursWeek, value: week > 0 ? hours(week, lang) : '—' },
          { label: t.hoursDays, value: String(days.length) },
        ].map(s => (
          <section key={s.label} className="border border-gray-100 rounded-2xl sm:rounded-3xl bg-white p-4 sm:p-6">
            <p className="text-[11px] sm:text-xs text-gray-400 leading-tight">{s.label}</p>
            <p className="text-lg sm:text-3xl font-semibold tracking-tight text-gray-900 mt-2 sm:mt-3">{s.value}</p>
          </section>
        ))}
      </div>

      {days.length === 0 ? (
        <section className="border border-gray-100 rounded-3xl bg-white p-10 text-center">
          <Clock size={22} className="mx-auto text-gray-300" />
          <p className="text-sm text-gray-400 mt-3">{t.hoursEmpty}</p>
        </section>
      ) : (
        <section className="border border-gray-100 rounded-3xl bg-white divide-y divide-gray-100">
          {days.slice(0, shown).map(d => (
            <div key={d.day} className="p-6 lg:px-8">
              <div className="flex items-start sm:items-center gap-2.5 mb-4">
                <CalendarDays size={15} className="text-gray-400 flex-shrink-0" />
                <p className="text-[15px] font-semibold text-gray-900 flex-1 min-w-0 sm:truncate">{label(d.day)}</p>
                <p className="text-sm font-semibold text-gray-900 tabular-nums">{hours(dayTotal(d), lang)}</p>
              </div>
              <div className="flex flex-col gap-3">
                {d.tasks.map(x => (
                  <div key={x.task_id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5.5rem] items-center gap-x-4 gap-y-1.5">
                    <p className="text-sm text-gray-700 truncate" title={titles[x.task_id]}>{titles[x.task_id] ?? '—'}</p>
                    <div className="col-span-2 sm:col-span-1 row-start-2 sm:row-start-auto h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(3, (x.seconds / longest) * 100)}%` }} />
                    </div>
                    <p className="text-sm font-medium text-gray-900 tabular-nums text-right row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto">{hours(x.seconds, lang)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {days.length > shown && (
            <div className="p-5 text-center">
              <button onClick={() => setShown(n => n + PAGE)} className="text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-200 hover:border-gray-900 rounded-full px-5 py-2 transition-colors">
                {t.hoursMore}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
