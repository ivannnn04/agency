import { NextResponse } from 'next/server'
import { imapConfig, syncMail } from '@/lib/mailSync'

// Pull lead correspondence from the mailbox into the lead cards. Admin-only
// via the NextAuth middleware.

export const maxDuration = 300

export async function POST() {
  if (!imapConfig()) return NextResponse.json({ error: 'Пошта не налаштована' }, { status: 400 })
  try {
    return NextResponse.json(await syncMail())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 })
  }
}
