'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// "Move task to another project" select for task panels (team + admin boards).
// The parent handles the actual move; this just picks the target project.
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
    <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
      <span className="text-sm text-gray-400 w-28 flex-shrink-0">Проєкт</span>
      <select
        value=""
        onChange={e => {
          const pid = e.target.value
          if (!pid) return
          const name = projects.find(p => p.id === pid)?.name ?? ''
          if (window.confirm(`Перенести задачу в проєкт «${name}»?`)) onMove(pid)
          else e.target.value = ''
        }}
        className="flex-1 text-sm text-gray-600 focus:outline-none bg-transparent cursor-pointer"
      >
        <option value="">Перенести в інший проєкт...</option>
        {others.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  )
}
