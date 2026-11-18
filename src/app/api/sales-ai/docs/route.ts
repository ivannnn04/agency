import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Context documents and meeting transcripts of a Sales AI room.
// Admin-only (NextAuth middleware) — see ../rooms/route.ts.

const MAX_CONTENT = 1_500_000 // chars; a one-hour transcript is ~60k

const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get('room')
  if (!roomId) return NextResponse.json({ error: 'room is required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('sales_docs')
    .select('id, room_id, kind, title, content, summary, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ docs: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const roomId = idOrNull(body?.room_id)
  if (!roomId) return NextResponse.json({ error: 'room_id is required' }, { status: 400 })
  const content = String(body?.content ?? '')
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'Документ завеликий — розбий його на частини' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('sales_docs')
    .insert({
      room_id: roomId,
      kind: body?.kind === 'meeting' ? 'meeting' : 'doc',
      title: String(body?.title ?? '').slice(0, 300).trim() || 'Без назви',
      content,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ doc: data })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = idOrNull(body?.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('title' in body) patch.title = String(body.title ?? '').slice(0, 300).trim() || 'Без назви'
  if ('content' in body) {
    const content = String(body.content ?? '')
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ error: 'Документ завеликий — розбий його на частини' }, { status: 400 })
    }
    patch.content = content
  }
  if ('summary' in body) patch.summary = body.summary ? String(body.summary).slice(0, 50000) : null
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { data, error } = await supabaseAdmin.from('sales_docs').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ doc: data })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = idOrNull(body?.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('sales_docs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
