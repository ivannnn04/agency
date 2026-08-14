import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

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

  const form = await req.formData()
  const taskId = String(form.get('taskId') ?? '')
  const content = String(form.get('content') ?? '').trim()
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)

  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  if (!content && files.length === 0) {
    return NextResponse.json({ error: 'Add a description or at least one file' }, { status: 400 })
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Up to ${MAX_FILES} files per request` }, { status: 400 })
  }

  // The task must belong to this project (no cross-project submissions)
  const { data: task } = await supabaseAdmin
    .from('pm_tasks').select('id, title').eq('id', taskId).eq('finance_project_id', id).single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // Enforce the admin-configured per-task limit
  const [{ data: project }, { count }] = await Promise.all([
    supabaseAdmin.from('projects').select('change_request_limit').eq('id', id).single(),
    supabaseAdmin.from('change_requests').select('id', { count: 'exact', head: true }).eq('task_id', taskId),
  ])
  const limit = project?.change_request_limit ?? 3
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: `Change request limit reached for this task (${limit}). Please contact the team in chat.` },
      { status: 400 },
    )
  }

  // Upload attachments
  const uploaded: { url: string; name: string }[] = []
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${file.name}" is too big — 10 MB max` }, { status: 400 })
    }
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `cr/${id}/${crypto.randomUUID()}-${safe}`
    const buf = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabaseAdmin.storage
      .from('chat-files')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream' })
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 })
    const { data: pub } = supabaseAdmin.storage.from('chat-files').getPublicUrl(path)
    uploaded.push({ url: pub.publicUrl, name: file.name })
  }

  const senderName = client.name || client.email

  const { data: cr, error } = await supabaseAdmin
    .from('change_requests')
    .insert({
      task_id: taskId,
      project_id: id,
      client_id: client.id,
      client_name: senderName,
      content,
      files: uploaded,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Surface it where the team already looks: the client chat channel...
  await supabaseAdmin.from('project_messages').insert({
    project_id: id,
    channel: 'client',
    sender_type: 'client',
    sender_name: senderName,
    client_id: client.id,
    content: `📝 Change request — «${task.title}»\n${content}${uploaded.length > 1 ? `\n(+${uploaded.length - 1} more files)` : ''}`,
    file_url: uploaded[0]?.url ?? null,
    file_name: uploaded[0]?.name ?? null,
  })

  // ...and as bell notifications for everyone assigned to the task
  const { data: assignees } = await supabaseAdmin
    .from('task_assignees').select('team_member_id').eq('task_id', taskId)
  for (const a of assignees ?? []) {
    await supabaseAdmin.from('notifications').insert({
      type: 'change_request',
      message: `Клієнт ${senderName} створив change request по задачі «${task.title}»`,
      project_id: id,
      task_id: taskId,
      team_member_id: a.team_member_id,
      recipient_team_member_id: a.team_member_id,
    })
  }

  return NextResponse.json(cr)
}
