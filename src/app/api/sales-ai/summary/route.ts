import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { buildSalesContext } from '@/lib/salesContext'

// After a call ends: turn its transcript into a debrief that is stored on
// the meeting and becomes compact context for the next call with this
// client. Admin-only via the NextAuth middleware.

export const maxDuration = 120

const MODEL = process.env.SALES_AI_MODEL || 'claude-sonnet-5'

const DEBRIEF = `Ти допомагаєш Івану, засновнику агенції Gudrix (UX/UI дизайн і розробка), розібрати щойно завершений дзвінок із клієнтом. У транскрипті «Я» — Іван, «Клієнт» — сторона клієнта, «Розмова» — один мікрофон на всіх.

Напиши розбір українською, простим текстом без markdown-розмітки, з такими розділами (назва розділу окремим рядком, під нею зміст):

Підсумок — 3–5 речень про те, що відбулось.
Що потрібно клієнту — його задачі, болі та критерії успіху його ж словами.
Заперечення — що викликало сумнів, як це закрили і що лишилось відкритим.
Домовленості — про що конкретно домовились обидві сторони.
Наступні кроки — хто, що і до коли.
Шанси і що зробити, щоб виграти — чесна оцінка і 2–3 конкретні дії.
Чернетка follow-up листа — мовою, якою йшов дзвінок, готова до відправки.

Спирайся лише на транскрипт і довідку про клієнта. Якщо для розділу нічого не прозвучало, так і напиши одним реченням — нічого не вигадуй. Транскрипт автоматичний, тому очевидні помилки розпізнавання читай за змістом.`

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY не налаштований' }, { status: 500 })
  }
  const body = await req.json().catch(() => null)
  const roomId = typeof body?.roomId === 'string' ? body.roomId : ''
  const docId = typeof body?.docId === 'string' ? body.docId : ''
  const transcript = String(body?.transcript ?? '').trim()
  if (!roomId || !docId) return NextResponse.json({ error: 'roomId and docId are required' }, { status: 400 })
  if (!transcript) return NextResponse.json({ error: 'transcript is empty' }, { status: 400 })

  const built = await buildSalesContext(roomId, docId)
  if (!built) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: DEBRIEF,
      messages: [{
        role: 'user',
        content: `<client_background>\n${built.context}\n</client_background>\n\n<call_transcript>\n${transcript.slice(-300_000)}\n</call_transcript>`,
      }],
    })
    const summary = msg.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    if (!summary) return NextResponse.json({ error: 'Порожній підсумок' }, { status: 502 })

    const { error } = await supabaseAdmin.from('sales_docs').update({ summary }).eq('id', docId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ summary })
  } catch (e) {
    return NextResponse.json({ error: `Claude не відповів: ${(e as Error).message.slice(0, 200)}` }, { status: 502 })
  }
}
