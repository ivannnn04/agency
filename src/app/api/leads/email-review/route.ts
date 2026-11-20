import { NextRequest, NextResponse } from 'next/server'
import { reviewLeadEmails } from '@/lib/emailReview'

// AI review of a lead's letters. Admin-only via the NextAuth middleware.

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  try {
    return NextResponse.json(await reviewLeadEmails(leadId, body?.force === true))
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.json({
      error: /ai_review|schema cache/i.test(msg)
        ? 'Запусти міграцію supabase/lead_mail_review_migration.sql у Supabase SQL Editor'
        : msg.slice(0, 300),
    }, { status: 502 })
  }
}
