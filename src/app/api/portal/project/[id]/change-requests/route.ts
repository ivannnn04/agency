import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

const MAX_FILES = 5

// Files are uploaded straight to storage from the browser (Vercel caps API
// bodies at ~4.5MB), so the request only carries their public URLs. Accept
// only URLs that point into our own bucket.
function isOwnStorageUrl(u: unknown): u is string {
  return typeof u === 'string' && u.includes('/storage/v1/object/public/chat-files/')
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

  const body = await req.json().catch(() => null)
  const taskId = String(body?.taskId ?? '')
  const content = String(body?.content ?? '').trim()
  const rawFiles: unknown[] = Array.isArray(body?.files) ? body.files : []
  const uploaded = rawFiles
    .filter((f): f is { url: string; name: string } =>
      !!f && typeof f === 'object' && isOwnStorageUrl((f as { url?: unknown }).url))
    .map(f => ({ url: f.url, name: String(f.name ?? 'file').slice(0, 200) }))

  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  if (!content && uploaded.length === 0) {
    return NextResponse.json({ error: 'Add a description or at least one file' }, { status: 400 })
  }
  if (uploaded.length > MAX_FILES) {
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
