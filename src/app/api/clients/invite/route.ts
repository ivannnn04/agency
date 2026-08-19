import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

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

async function requireAdmin() {
  const jar = await cookies()
  const sessionToken =
    jar.get('__Secure-next-auth.session-token')?.value ??
    jar.get('next-auth.session-token')?.value
  if (!sessionToken) return false
  const token = await decode({ token: sessionToken, secret: process.env.NEXTAUTH_SECRET! })
  return token?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { clientId, projectName } = await req.json()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env
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

  const firstName = (client.name ?? '').split(' ')[0]
  const projectLine = projectName
    ? `You now have access to the <b>${projectName}</b> project — track progress, see the timeline, and chat with the team.`
    : 'Track your project progress, see the timeline, and chat with the team.'

  try {
    await transporter.sendMail({
      from: SMTP_FROM ?? SMTP_USER,
      to: client.email,
      subject: 'Your Gudrix client portal access',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="width:36px;height:36px;background:#14b8a6;border-radius:10px;color:#fff;font-weight:bold;text-align:center;line-height:36px;font-size:16px">G</div>
            <span style="font-size:16px;font-weight:600;color:#111827">&nbsp;Gudrix — Client Portal</span>
          </div>
          <p style="font-size:15px;color:#111827">Hi${firstName ? ` ${firstName}` : ''},</p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            Welcome to the Gudrix client portal! ${projectLine}
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            Click the button below to set your password and sign in:
          </p>
          <p style="margin:28px 0">
            <a href="${inviteUrl}"
               style="background:#14b8a6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;display:inline-block">
              Activate my access
            </a>
          </p>
          <p style="font-size:12px;color:#9ca3af;line-height:1.6">
            From then on, sign in at ${origin}/portal/login with ${client.email} and your password.<br/>
            If you weren’t expecting this email, you can safely ignore it.
          </p>
        </div>
      `,
    })
  } catch (e) {
    return NextResponse.json({ error: `Не вдалося надіслати лист: ${e instanceof Error ? e.message : 'SMTP error'}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
