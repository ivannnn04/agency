import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Attach a synced call to a project, or detach it. Admin-only via the
// NextAuth middleware.

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id || !('project_id' in (body ?? {}))) return NextResponse.json({ error: 'id and project_id are required' }, { status: 400 })
  const projectId = typeof body.project_id === 'string' ? body.project_id : null

  // Attaching by hand also brings back a call that was filed as internal
  const patch = projectId ? { project_id: projectId, ignored: false } : { project_id: null }
  const { error } = await supabaseAdmin.from('lead_meetings').update(patch).eq('id', id)
  if (error) {
    const msg = /project_id|schema cache/i.test(error.message)
      ? 'Запусти міграцію supabase/project_program_migration.sql у Supabase SQL Editor'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
