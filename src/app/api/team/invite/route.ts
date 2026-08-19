import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

// Sends a team member an email invitation from the corporate mailbox.
// The link carries our own invite token → the member lands on /team/welcome
// and sets their password there. The token is only consumed when the form is
// submitted, so email scanners that prefetch links can't burn it (unlike
// Supabase one-time action links).

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

  const { id, email: newEmail } = await req.json()
  if (!id) return NextResponse.json({ error: 'Потрібен id учасника' }, { status: 400 })

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({
      error: 'SMTP не налаштовано. Додай SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS у змінні середовища.',
    }, { status: 501 })
  }

  const admin = adminClient()

  const { data: member, error: memErr } = await admin
    .from('team_members')
    .select('id, name, email, supabase_user_id, invite_token, invite_expires_at')
    .eq('id', id)
    .single()
  if (memErr || !member) return NextResponse.json({ error: 'Учасника не знайдено' }, { status: 404 })

  const email = (newEmail && String(newEmail).trim()) || member.email
  if (!email) return NextResponse.json({ error: 'У учасника немає email — вкажіть його для запрошення' }, { status: 400 })

  // Make sure an auth account exists (no password yet — the member sets it)
  let userId = member.supabase_user_id as string | null
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createErr) {
      // The email may already have an auth account (e.g. re-invite after unlink)
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list?.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
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
    member.invite_token && member.invite_expires_at && member.invite_expires_at > new Date().toISOString()
  const inviteToken = tokenStillValid
    ? (member.invite_token as string)
    : crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const inviteExpires = new Date(Date.now() + 7 * 86400000).toISOString()
  const inviteUrl = `${origin}/team/welcome?token=${inviteToken}`

  // Store the token BEFORE sending — a stored-but-unsent token is harmless,
  // an emailed-but-unstored one is a dead link
  const { error: updErr } = await admin
    .from('team_members')
    .update({
      supabase_user_id: userId,
      email,
      invited_at: new Date().toISOString(),
      invite_token: inviteToken,
      invite_expires_at: inviteExpires,
    })
    .eq('id', id)
  if (updErr) {
    return NextResponse.json({ error: `Не вдалося зберегти запрошення — запусти міграцію team_invite_tokens_migration.sql (${updErr.message})` }, { status: 500 })
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: Number(SMTP_PORT ?? 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  const firstName = member.name.split(' ')[0]
  try {
    await transporter.sendMail({
      from: SMTP_FROM ?? SMTP_USER,
      to: email,
      subject: 'You’re invited to Gudrix Cowork Space',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="width:36px;height:36px;background:#14b8a6;border-radius:10px;color:#fff;font-weight:bold;text-align:center;line-height:36px;font-size:16px">G</div>
            <span style="font-size:16px;font-weight:600;color:#111827">&nbsp;Gudrix Cowork Space</span>
          </div>
          <p style="font-size:15px;color:#111827">Hi${firstName ? ` ${firstName}` : ''},</p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            You’ve been invited to the Gudrix team workspace. This is where you’ll see your
            projects and tasks, and chat with the team.
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            Click the button below to set your password and sign in:
          </p>
          <p style="margin:28px 0">
            <a href="${inviteUrl}"
               style="background:#14b8a6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;display:inline-block">
              Accept invitation
            </a>
          </p>
          <p style="font-size:12px;color:#9ca3af;line-height:1.6">
            From then on, sign in at ${origin}/team/login with ${email} and your password.<br/>
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
