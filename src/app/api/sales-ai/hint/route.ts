import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildSalesContext } from '@/lib/salesContext'

// Live coaching during a sales call: given the client's background and the
// rolling transcript, Claude returns 0–3 hints for what to say next plus an
// updated running memory of the call. Called every few seconds while the
// call runs, so the big static part (instructions + client background) is
// one cached prefix and only the short transcript tail is new each time.
// Admin-only via the NextAuth middleware.

export const maxDuration = 60

const MODEL = process.env.SALES_AI_MODEL || 'claude-sonnet-5'

const COACH = `You are a real-time sales coach sitting silently next to Ivan during a live client call. Ivan is the founder of Gudrix, a full-cycle UX/UI design and development agency. Only Ivan sees what you write; the client never does.

You are given background on this client (Ivan's brief, the CRM lead, any running project, materials and transcripts of previous meetings) and, on every call, the most recent part of the live transcript. In the transcript "Я" is Ivan and "Клієнт" is the client side; "Розмова" means one microphone picked up everyone, so work out who is speaking from the content.

Your job is to help Ivan win this deal by being genuinely useful to the client. Each time you are called, decide whether there is something worth telling him right now, and return between zero and three hints. Ivan is mid-conversation and can only glance at the screen, so a hint has to earn its place: return an empty list when nothing new has happened, when the talk is small talk, or when he is already handling it well. Never repeat or rephrase a hint from the already-shown list.

Hint kinds:
- ask: a discovery question worth asking at this moment (budget, timeline, decision process, the pain behind the request, success criteria).
- objection: the client raised a doubt or pushed back; how to respond to it.
- answer: the client asked something; a strong, specific answer built from the background.
- value: a moment to connect what the client just said to relevant proof, a past result, or something agreed in an earlier meeting.
- risk: a warning for Ivan himself, such as a buying signal he missed, a concern left unaddressed, or talking too long without checking in.
- close: the conversation is ready for a concrete next step or commitment; propose it.

For each hint, "say" is a line Ivan can say almost word for word: natural spoken language, in the language the call is being held in, at most about 30 words. "why" is the trigger or reasoning in Ukrainian, at most about 12 words.

Ground everything in the background and the transcript. Use the client's own words and refer to what was said or agreed in previous meetings when it helps. Do not invent facts, prices, deadlines, case studies or commitments that are not in the material; when Ivan needs a fact you do not have, suggest an honest way to handle it, such as promising to follow up with specifics. Winning by misleading the client is not winning, so keep the advice honest.

You only see a window of the latest transcript, so "memory" is how you remember the rest of the call. Each time, return updated running notes of this call in at most 120 words: needs and pains, budget and timeline signals, who decides, objections raised and whether they were resolved, commitments made by either side. Carry forward what still matters from the previous memory.

When Ivan asks you a direct question, answer it first as a hint of kind "answer", as concretely as the material allows.`

type HintKind = 'ask' | 'objection' | 'answer' | 'value' | 'risk' | 'close'
const KINDS: HintKind[] = ['ask', 'objection', 'answer', 'value', 'risk', 'close']

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY не налаштований' }, { status: 500 })
  }
  const body = await req.json().catch(() => null)
  const roomId = typeof body?.roomId === 'string' ? body.roomId : ''
  if (!roomId) return NextResponse.json({ error: 'roomId is required' }, { status: 400 })

  const transcript = String(body?.transcript ?? '').slice(-16000)
  const memory = String(body?.memory ?? '').slice(0, 2000)
  const shown: string[] = Array.isArray(body?.shown) ? body.shown.slice(-10).map((s: unknown) => String(s).slice(0, 300)) : []
  const question = String(body?.question ?? '').slice(0, 1000).trim()
  if (!transcript.trim() && !question) return NextResponse.json({ hints: [], memory })

  const built = await buildSalesContext(roomId, typeof body?.meetingDocId === 'string' ? body.meetingDocId : null)
  if (!built) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const turn = [
    `<call_memory>\n${memory || '(початок дзвінка — памʼяті ще немає)'}\n</call_memory>`,
    `<recent_transcript>\n${transcript || '(ще нічого не сказано)'}\n</recent_transcript>`,
    `<already_shown_hints>\n${shown.length > 0 ? shown.map(s => `- ${s}`).join('\n') : '(немає)'}\n</already_shown_hints>`,
    question ? `<ivan_question>\n${question}\n</ivan_question>` : '',
  ].filter(Boolean).join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: [
        { type: 'text', text: COACH },
        // Stable for the whole call → cached after the first request
        { type: 'text', text: `<client_background>\n${built.context}\n</client_background>`, cache_control: { type: 'ephemeral' } },
      ],
      tools: [
        {
          name: 'coach',
          description: 'Report the hints for Ivan (possibly none) and the updated call memory.',
          input_schema: {
            type: 'object',
            properties: {
              hints: {
                type: 'array',
                description: 'Zero to three hints, most important first. Empty when nothing is worth saying now.',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: KINDS },
                    say: { type: 'string', description: 'Ready-to-say line in the language of the call' },
                    why: { type: 'string', description: 'Short reason in Ukrainian' },
                  },
                  required: ['kind', 'say', 'why'],
                },
              },
              memory: { type: 'string', description: 'Updated running notes of this call, at most 120 words' },
            },
            required: ['hints', 'memory'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'coach' },
      messages: [{ role: 'user', content: turn }],
    })

    const tu = msg.content.find(b => b.type === 'tool_use')
    const input = (tu && tu.type === 'tool_use' ? tu.input : {}) as {
      hints?: { kind?: string; say?: string; why?: string }[]
      memory?: string
    }
    const hints = (Array.isArray(input.hints) ? input.hints : [])
      .filter(h => h && typeof h.say === 'string' && h.say.trim())
      .slice(0, 3)
      .map(h => ({
        kind: (KINDS as string[]).includes(h.kind ?? '') ? (h.kind as HintKind) : 'ask',
        say: String(h.say).trim(),
        why: String(h.why ?? '').trim(),
      }))

    return NextResponse.json({
      hints,
      memory: typeof input.memory === 'string' && input.memory.trim() ? input.memory.trim() : memory,
      cached: msg.usage.cache_read_input_tokens ?? 0,
    })
  } catch (e) {
    return NextResponse.json({ error: `Claude не відповів: ${(e as Error).message.slice(0, 200)}` }, { status: 502 })
  }
}
