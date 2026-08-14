import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

// Clients only ever see the 'client' channel — the team channel never leaves the server.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: messages } = await supabaseAdmin
    .from('project_messages')
    .select('id, sender_type, sender_name, content, created_at')
    .eq('project_id', id)
    .eq('channel', 'client')
    .order('created_at', { ascending: true })
    .limit(500)

  return NextResponse.json({ messages: messages ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { content } = await req.json()
  const text = String(content ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Порожнє повідомлення' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('project_messages')
    .insert({
      project_id: id,
      channel: 'client',
      sender_type: 'client',
      sender_name: client.name || client.email,
      client_id: client.id,
      content: text.slice(0, 4000),
    })
    .select('id, sender_type, sender_name, content, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
