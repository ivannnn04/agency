import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

// Clients only ever see the 'client' channel — the team channel never leaves the server.

const MESSAGE_FIELDS = 'id, sender_type, sender_name, content, file_url, file_name, created_at'
const MAX_FILE_BYTES = 10 * 1024 * 1024

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
    .select(MESSAGE_FIELDS)
    .eq('project_id', id)
    .eq('channel', 'client')
    .order('created_at', { ascending: true })
    .limit(500)

  // Reactions only for the client-channel messages above — nothing from the
  // team channel ever leaves the server
  const messageIds = (messages ?? []).map(m => m.id)
  let reactions: { message_id: string; emoji: string; reactor_key: string; reactor_name: string | null }[] = []
  if (messageIds.length > 0) {
    const { data: rx } = await supabaseAdmin
      .from('message_reactions')
      .select('message_id, emoji, reactor_key, reactor_name')
      .in('message_id', messageIds)
    reactions = rx ?? []
  }

  return NextResponse.json({
    messages: messages ?? [],
    reactions,
    myKey: `client:${client.id}`,
  })
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

  let text = ''
  let fileUrl: string | null = null
  let fileName: string | null = null

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    text = String(form.get('content') ?? '').trim()
    const file = form.get('file')
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File is too big — 10 MB max' }, { status: 400 })
      }
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
      const path = `${id}/${crypto.randomUUID()}-${safe}`
      const buf = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await supabaseAdmin.storage
        .from('chat-files')
        .upload(path, buf, { contentType: file.type || 'application/octet-stream' })
      if (upErr) {
        return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 })
      }
      const { data: pub } = supabaseAdmin.storage.from('chat-files').getPublicUrl(path)
      fileUrl = pub.publicUrl
      fileName = file.name
    }
  } else {
    const { content } = await req.json()
    text = String(content ?? '').trim()
  }

  if (!text && !fileUrl) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('project_messages')
    .insert({
      project_id: id,
      channel: 'client',
      sender_type: 'client',
      sender_name: client.name || client.email,
      client_id: client.id,
      content: text.slice(0, 4000),
      file_url: fileUrl,
      file_name: fileName,
    })
    .select(MESSAGE_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
