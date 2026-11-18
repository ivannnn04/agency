import { NextRequest, NextResponse } from 'next/server'

// Speech-to-text for the live sales call: the browser cuts each speaker's
// audio into short utterances and posts them here one by one. Admin-only
// via the NextAuth middleware.

export const maxDuration = 60

// Speech models invent these on near-silent audio; a segment that is ONLY
// one of them is dropped.
const HALLUCINATIONS = new Set([
  'thank you for watching',
  'thanks for watching',
  'subtitles by the amara.org community',
  'дякую за перегляд',
  'субтитри створював dimatorzok',
  'субтитры создавал dimatorzok',
  'субтитры сделал dimatorzok',
  'продолжение следует',
  'you',
])

const normalize = (s: string) => s.toLowerCase().replace(/[.!?…,"'«»]/g, '').trim()

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'Для живої транскрипції додай OPENAI_API_KEY у Vercel і зроби Redeploy' },
      { status: 500 },
    )
  }

  const form = await req.formData()
  const audio = form.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 })
  }
  if (audio.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'audio segment too large' }, { status: 400 })
  }
  const lang = String(form.get('lang') ?? 'auto')
  const hint = String(form.get('hint') ?? '').slice(0, 300)

  async function transcribe(model: string) {
    const out = new FormData()
    out.append('file', audio as File, (audio as File).name || 'segment.webm')
    out.append('model', model)
    if (lang && lang !== 'auto') out.append('language', lang)
    // Names the model would otherwise misspell
    if (hint) out.append('prompt', `Sales call. Gudrix, ${hint}.`)
    return fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    })
  }

  const primary = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
  let res = await transcribe(primary)
  // Accounts without access to the newer model still have whisper-1
  if (!res.ok && primary !== 'whisper-1' && [400, 403, 404].includes(res.status)) {
    res = await transcribe('whisper-1')
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `Транскрипція не вдалася (${res.status}): ${detail.slice(0, 200)}` },
      { status: 502 },
    )
  }

  const data = await res.json()
  const text = String(data.text ?? '').trim()
  if (HALLUCINATIONS.has(normalize(text))) return NextResponse.json({ text: '' })
  return NextResponse.json({ text })
}
