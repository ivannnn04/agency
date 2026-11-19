import { NextRequest, NextResponse } from 'next/server'
import { generateLeadBrief, getLeadBrief } from '@/lib/leadInsight'

// Design brief for a lead, written as a prompt. Admin-only via the NextAuth
// middleware.

export const maxDuration = 300

const hint = (msg: string) =>
  /lead_briefs|schema cache/i.test(msg) ? 'Запусти міграцію supabase/lead_brief_migration.sql у Supabase SQL Editor' : msg.slice(0, 300)

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead') ?? ''
  if (!leadId) return NextResponse.json({ error: 'lead is required' }, { status: 400 })
  return NextResponse.json({ brief: await getLeadBrief(leadId).catch(() => null) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  try {
    return NextResponse.json({ brief: await generateLeadBrief(leadId, body?.lang === 'uk' ? 'uk' : 'en') })
  } catch (e) {
    return NextResponse.json({ error: hint((e as Error).message) }, { status: 502 })
  }
}
