'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CallListener from '@/components/chat/CallListener'

// Shared shell for all /team/* pages. It stays mounted while the member
// navigates between the dashboard, boards and reports — so the global
// call host lives here and an active voice call survives navigation.

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<{ id: string; name: string; color: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: mem } = await supabase
        .from('team_members')
        .select('id, name, color')
        .eq('supabase_user_id', user.id)
        .single()
      if (mem) setMember(mem as { id: string; name: string; color: string })
    })()
  }, [])

  return (
    <>
      {member && (
        <CallListener
          selfKey={`team-${member.id}`}
          selfName={member.name}
          selfColor={member.color || '#14b8a6'}
        />
      )}
      {children}
    </>
  )
}
