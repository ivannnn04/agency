import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { mailFrom } from '@/lib/mailer'
import { requireAdmin } from '@/lib/adminAuth'
import { clientInviteEmail } from '@/lib/clientInviteEmail'

// Sends a portal client an email invitation from the corporate mailbox.
// Same own-token flow as team invites: the link carries our single-use token,
// consumed only when the password form is submitted on /portal/welcome.

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { clientId, projectName } = await req.json()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({
      error: 'SMTP не налаштовано. Додай SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS у змінні середовища.',
    }, { status: 501 })
  }

  const admin = adminClient()

  const { data: client, error: cliErr } = await admin
    .from('clients')
    .select('id, name, email, auth_user_id, invite_token, invite_expires_at')
    .eq('id', clientId)
    .single()
  if (cliErr || !client) return NextResponse.json({ error: 'Клієнта не знайдено' }, { status: 404 })
  if (!client.email) return NextResponse.json({ error: 'У клієнта немає email' }, { status: 400 })

  // Make sure an auth account exists (no password yet — the client sets it)
  let userId = client.auth_user_id as string | null
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: client.email,
      email_confirm: true,
    })
    if (createErr) {
      // The email may already have an auth account (e.g. self-signup earlier)
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list?.users.find(u => u.email?.toLowerCase() === client.email.toLowerCase())
      if (!existing) return NextResponse.json({ error: createErr.message }, { status: 400 })
      userId = existing.id
    } else {
      userId = created.user.id
    }
  }

  // Canonical app URL first — invite links must never point at a preview deploy
  const origin = process.env.NEXT_PUBLIC_APP_URL
    ?? req.headers.get('origin')
    ?? new URL(req.url).origin
  // Re-sending reuses a still-valid token so links in EVERY sent email keep
  // working — a new token would silently kill the older emails
  const tokenStillValid =
    client.invite_token && client.invite_expires_at && client.invite_expires_at > new Date().toISOString()
  const inviteToken = tokenStillValid
    ? (client.invite_token as string)
    : crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const inviteExpires = new Date(Date.now() + 14 * 86400000).toISOString()
  const inviteUrl = `${origin}/portal/welcome?token=${inviteToken}`

  // Store the token BEFORE sending — a stored-but-unsent token is harmless,
  // an emailed-but-unstored one is a dead link
  const { error: updErr } = await admin
    .from('clients')
    .update({
      auth_user_id: userId,
      invited_at: new Date().toISOString(),
      invite_token: inviteToken,
      invite_expires_at: inviteExpires,
    })
    .eq('id', clientId)
  if (updErr) {
    return NextResponse.json({ error: `Не вдалося зберегти запрошення — запусти міграцію client_invites_migration.sql (${updErr.message})` }, { status: 500 })
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: Number(SMTP_PORT ?? 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  // Which project(s) this client is starting: the caller's hint, else the
  // projects they are attached to
  let projectNames: string[] = typeof projectName === 'string' && projectName.trim() ? [projectName.trim()] : []
  if (projectNames.length === 0) {
    const { data: links } = await admin.from('project_clients').select('projects(name)').eq('client_id', clientId)
    projectNames = ((links ?? []) as unknown as { projects: { name: string } | null }[])
      .map(l => l.projects?.name)
      .filter((n): n is string => !!n)
  }
  // The letter speaks the language of the client's workspace
  const { data: langRow } = await admin.from('clients').select('lang').eq('id', clientId).maybeSingle()
  const letter = clientInviteEmail({
    firstName: (client.name ?? '').trim().split(/\s+/)[0] ?? '',
    projectNames,
    inviteUrl,
    loginUrl: `${origin}/portal/login`,
    email: client.email,
    lang: langRow?.lang === 'uk' ? 'uk' : 'en',
  })

  try {
    await transporter.sendMail({
      from: mailFrom(),
      to: client.email,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
    })
  } catch (e) {
    return NextResponse.json({ error: `Не вдалося надіслати лист: ${e instanceof Error ? e.message : 'SMTP error'}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
