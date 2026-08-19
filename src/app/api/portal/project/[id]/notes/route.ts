import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

// Shared project notepad, client side. Clients read all notes and write their
// own (text + optional file); they can delete only their own notes.

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

  const { data: notes } = await supabaseAdmin
    .from('project_notes')
    .select('id, author_type, author_id, author_name, content, files, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ notes: notes ?? [], myId: client.id })
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
  const files: { url: string; name: string }[] = []

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
      const path = `${id}/${crypto.randomUUID()}-note-${safe}`
      const buf = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await supabaseAdmin.storage
        .from('chat-files')
        .upload(path, buf, { contentType: file.type || 'application/octet-stream' })
      if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 })
      const { data: pub } = supabaseAdmin.storage.from('chat-files').getPublicUrl(path)
      files.push({ url: pub.publicUrl, name: file.name })
    }
  } else {
    const { content } = await req.json()
    text = String(content ?? '').trim()
  }

  if (!text && files.length === 0) {
    return NextResponse.json({ error: 'Empty note' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('project_notes')
    .insert({
      project_id: id,
      author_type: 'client',
      author_id: client.id,
      author_name: client.name || client.email,
      content: text.slice(0, 8000),
      files,
    })
    .select('id, author_type, author_id, author_name, content, files, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const noteId = req.nextUrl.searchParams.get('noteId')
  if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 })

  // Clients only ever delete their own notes
  await supabaseAdmin
    .from('project_notes')
    .delete()
    .eq('id', noteId)
    .eq('project_id', id)
    .eq('author_type', 'client')
    .eq('author_id', client.id)

  return NextResponse.json({ ok: true })
}
