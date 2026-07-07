'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { FolderKanban } from 'lucide-react'

export default function BoardIndexPage() {
  const router = useRouter()

  useEffect(() => {
    supabase
      .from('projects')
      .select('id')
      .neq('status', 'archived')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) router.replace(`/board/${data.id}`)
      })
  }, [router])

  return (
    <div className="flex-1 flex items-center justify-center text-gray-400">
      <div className="text-center">
        <FolderKanban size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Виберіть або створіть проєкт у меню зліва</p>
      </div>
    </div>
  )
}
