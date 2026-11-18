import { NextResponse } from 'next/server'
import { fellowConfig } from '@/lib/fellow'
import { syncFellow } from '@/lib/fellowSync'

// Manual / on-open sync of Fellow recordings into the leads. Admin-only via
// the NextAuth middleware.

export const maxDuration = 300

export async function POST() {
  if (!fellowConfig()) {
    return NextResponse.json({ error: 'Додай FELLOW_API_KEY і FELLOW_SUBDOMAIN у Vercel і зроби Redeploy' }, { status: 400 })
  }
  try {
    return NextResponse.json(await syncFellow())
  } catch (e) {
    const msg = (e as Error).message
    const hint = /lead_meetings|integration_state|schema cache/i.test(msg)
      ? 'Запусти міграцію supabase/fellow_migration.sql у Supabase SQL Editor'
      : msg.slice(0, 300)
    return NextResponse.json({ error: hint }, { status: 502 })
  }
}
