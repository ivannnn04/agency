import { NextRequest, NextResponse } from 'next/server'

// Public demo for a client pitch: a selfie comes in, gpt-image-1 composes
// the person between two event hosts on a festive postcard, base64 goes
// back. No auth (the page is a shareable test), no storage — ephemeral.

export const maxDuration = 120

const PROMPT = `Create a festive corporate event greeting postcard in portrait orientation.
Take the exact person from the uploaded photo and place them standing in the CENTER of a glamorous stage,
BETWEEN two elegant smiling event hosts: a man in a classic black tuxedo on the left and a woman in an
evening gown on the right, both presenting the person with a welcoming gesture. Warm golden stage lights,
subtle confetti in the air, premium dark-green and gold color palette.
Keep the person's face realistic, recognizable and flattering — same facial features as the photo.
Design it like a real postcard: a thin elegant golden frame near the edges and the headline
"CORPORATE EVENT 2026" in stylish serif letters at the top, and a small line "with love from the team"
at the bottom. High quality, photorealistic, festive.`

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'OPENAI_API_KEY не налаштований на сервері' }, { status: 500 })
  }

  const form = await req.formData()
  const photo = form.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: 'Потрібне фото' }, { status: 400 })
  }
  if (photo.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'Фото завелике' }, { status: 400 })
  }

  const out = new FormData()
  out.append('model', 'gpt-image-1')
  out.append('image[]', photo, photo.name || 'selfie.jpg')
  out.append('prompt', PROMPT)
  out.append('size', '1024x1536')
  out.append('quality', 'medium')

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `Генерація не вдалася (${res.status}): ${detail.slice(0, 300)}` },
      { status: 502 },
    )
  }
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) return NextResponse.json({ error: 'Порожня відповідь генератора' }, { status: 502 })
  return NextResponse.json({ image: `data:image/png;base64,${b64}` })
}
