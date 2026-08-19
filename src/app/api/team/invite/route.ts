import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

// Sends a team member an email invitation from the corporate mailbox.
// The link is a Supabase recovery link → the member lands on /team/welcome
// with a session and sets their own password on first login.

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
    .select('id, name, email, supabase_user_id')
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

  // A recovery link doubles as a "set your password" link on first login
  const origin = req.headers.get('origin') ?? new URL(req.url).origin
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/team/welcome` },
  })
  if (linkErr || !linkData.properties?.action_link) {
    return NextResponse.json({ error: linkErr?.message ?? 'Не вдалося створити лінк запрошення' }, { status: 400 })
  }
  const inviteUrl = linkData.properties.action_link

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
      subject: 'Запрошення в Gudrix Cowork Space',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="width:36px;height:36px;background:#14b8a6;border-radius:10px;color:#fff;font-weight:bold;text-align:center;line-height:36px;font-size:16px">G</div>
            <span style="font-size:16px;font-weight:600;color:#111827">&nbsp;Gudrix Cowork Space</span>
          </div>
          <p style="font-size:15px;color:#111827">Привіт${firstName ? `, ${firstName}` : ''}!</p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            Тебе запросили до робочого простору команди Gudrix. Тут ти бачитимеш свої проєкти,
            задачі та спілкуватимешся з командою.
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            Натисни кнопку нижче, щоб встановити свій пароль і увійти:
          </p>
          <p style="margin:28px 0">
            <a href="${inviteUrl}"
               style="background:#14b8a6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;display:inline-block">
              Прийняти запрошення
            </a>
          </p>
          <p style="font-size:12px;color:#9ca3af;line-height:1.6">
            Надалі вхід — за адресою ${origin}/team/login з email ${email} та твоїм паролем.<br/>
            Якщо ти не очікуєш цього листа — просто проігноруй його.
          </p>
        </div>
      `,
    })
  } catch (e) {
    return NextResponse.json({ error: `Не вдалося надіслати лист: ${e instanceof Error ? e.message : 'SMTP error'}` }, { status: 502 })
  }

  // Link the auth account + remember the invite (email may be new for the member)
  await admin
    .from('team_members')
    .update({ supabase_user_id: userId, email, invited_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
