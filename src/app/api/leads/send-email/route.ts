import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'
import nodemailer from 'nodemailer'
import supabaseAdmin from '@/lib/supabaseAdmin'

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

  const { leadId, to, subject, body } = await req.json()
  if (!leadId || !to || !subject || !body) {
    return NextResponse.json({ error: 'leadId, to, subject і body обовʼязкові' }, { status: 400 })
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({
      error: 'SMTP не налаштовано. Додай SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (і опційно SMTP_FROM) у змінні середовища.',
    }, { status: 501 })
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: Number(SMTP_PORT ?? 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  const from = SMTP_FROM ?? SMTP_USER

  try {
    await transporter.sendMail({ from, to, subject, text: body })
  } catch (e) {
    return NextResponse.json({ error: `Не вдалося надіслати: ${(e as Error).message}` }, { status: 502 })
  }

  const { data, error } = await supabaseAdmin
    .from('lead_emails')
    .insert({ lead_id: leadId, direction: 'out', subject, body, to_email: to, from_email: from })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(data)
}
