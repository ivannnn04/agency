import { NextRequest, NextResponse } from 'next/server'

// Server-side speech-to-text fallback for browsers that block the built-in
// Web Speech API (Arc, Brave): the client records audio and sends it here;
// OpenAI Whisper transcribes it. Admin-only via the NextAuth middleware.

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'Твій браузер блокує вбудоване розпізнавання. Додай OPENAI_API_KEY у Vercel (для Whisper) або користуйся голосом у Chrome/Safari.' },
      { status: 500 },
    )
  }

  const form = await req.formData()
  const audio = form.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 })
  }
  if (audio.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'Запис задовгий — скажи коротше' }, { status: 400 })
  }

  const out = new FormData()
  out.append('file', audio, audio.name || 'voice.webm')
  out.append('model', 'whisper-1')
  out.append('language', 'uk')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json({ error: `Whisper не відповів (${res.status}): ${detail.slice(0, 200)}` }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ transcript: String(data.text ?? '').trim() })
}
