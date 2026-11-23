import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'
import { prepareReview, reviewKey, sendReview } from '@/lib/documentReview'

// Admin: send a project note (a document) to the client for review.
// GET  ?project=   which notes were already sent, and when
// POST { noteId, action: 'preview' | 'send', message? }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project')
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })
  const { data: notes } = await supabaseAdmin.from('project_notes').select('id').eq('project_id', projectId)
  const ids = (notes ?? []).map(n => n.id as string)
  const sent: Record<string, { at: string; to: string[] }> = {}
  if (ids.length) {
    const { data: rows } = await supabaseAdmin.from('integration_state').select('key, value').in('key', ids.map(reviewKey))
    for (const row of rows ?? []) {
      const v = row.value as { at?: string; to?: string[] } | null
      if (v?.at) sent[String(row.key).slice('note_review:'.length)] = { at: v.at, to: v.to ?? [] }
    }
  }
  return NextResponse.json({ sent })
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { noteId?: string; action?: string; message?: string } | null
  const noteId = typeof body?.noteId === 'string' ? body.noteId : ''
  if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 })
  const message = typeof body?.message === 'string' ? body.message.slice(0, 6000) : undefined
  const origin = req.nextUrl.origin

  if (body?.action === 'send') {
    const r = await sendReview(noteId, message, origin)
    if ('status' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(r)
  }

  const p = await prepareReview(noteId, message, origin)
  if ('error' in p) return NextResponse.json({ error: p.error }, { status: p.status })
  // The preview shows the letter as the first recipient will get it
  const sample = p.to[0] ?? { email: '', name: null, lang: 'en' as const }
  const mail = p.build(sample)
  return NextResponse.json({
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    defaultLetter: p.defaultLetter,
    recipients: p.to,
    files: p.files.map(f => ({ name: f.name, size: f.size, attached: f.attached })),
  })
}
