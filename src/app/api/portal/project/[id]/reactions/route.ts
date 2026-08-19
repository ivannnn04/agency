import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

// Toggle a client's emoji reaction on a client-channel message.

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

  const { messageId, emoji } = await req.json()
  if (!messageId || !emoji || String(emoji).length > 16) {
    return NextResponse.json({ error: 'messageId and emoji are required' }, { status: 400 })
  }

  // The message must belong to this project's client channel
  const { data: msg } = await supabaseAdmin
    .from('project_messages')
    .select('id')
    .eq('id', messageId)
    .eq('project_id', id)
    .eq('channel', 'client')
    .single()
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const reactorKey = `client:${client.id}`

  const { data: existing } = await supabaseAdmin
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('emoji', emoji)
    .eq('reactor_key', reactorKey)
    .single()

  if (existing) {
    await supabaseAdmin.from('message_reactions').delete().eq('id', existing.id)
    return NextResponse.json({ ok: true, removed: true })
  }

  const { error } = await supabaseAdmin.from('message_reactions').insert({
    message_id: messageId,
    project_id: id,
    emoji,
    reactor_key: reactorKey,
    reactor_name: client.name || client.email,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, removed: false })
}
