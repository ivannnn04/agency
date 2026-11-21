'use client'

import { useEffect, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// "Move task to another project" for task panels (team + admin boards). A
// rare action, so it sits as a quiet link under the task fields instead of
// taking a row of its own. The parent handles the actual move.
export default function MoveTaskProject({ currentProjectId, onMove }: {
  currentProjectId: string
  onMove: (projectId: string) => void
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .neq('status', 'archived')
        .order('name')
      if (data) setProjects(data)
    })()
  }, [])

  const others = projects.filter(p => p.id !== currentProjectId)
  if (others.length === 0) return null

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 cursor-pointer mt-1 px-2 -mx-2">
      <ArrowRightLeft size={11} />
      <select
        value=""
        onChange={e => {
          const pid = e.target.value
          if (!pid) return
          const name = projects.find(p => p.id === pid)?.name ?? ''
          if (window.confirm(`Перенести задачу в проєкт «${name}»?`)) onMove(pid)
          else e.target.value = ''
        }}
        className="text-xs text-inherit focus:outline-none bg-transparent cursor-pointer"
      >
        <option value="">Перенести в інший проєкт…</option>
        {others.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  )
}
