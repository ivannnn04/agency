import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { buildLeadContext, getAgencyProfile } from '@/lib/leadInsight'
import { DEAL_FACTORS } from '@/lib/dealFactors'

// Chat with an AI sales advisor inside a lead's card. It answers from
// everything stored on the lead; the reply is streamed as plain text.
// Admin-only via the NextAuth middleware.

export const maxDuration = 300

const MODEL = process.env.LEAD_CHAT_MODEL || process.env.LEAD_AI_MODEL || 'claude-opus-5'

const ADVISOR = `You are the sales advisor Ivan talks to inside a lead's card in his agency's CRM. Ivan is the founder of Gudrix, a full-cycle UX/UI design and development agency. Below is everything Gudrix has on this lead: CRM fields, qualification facts, the current deal scorecard, the correspondence, the outreach thread, and notes and transcripts of calls. Ivan asks you what to do, how to phrase something, how to read the client, or to draft a message.

Answer like a sharp colleague who has read the whole file: lead with the answer, keep it short, and make it specific to this client by pointing to what they actually said or did. Give your honest read even when it is not what Ivan hopes to hear, and say plainly when the material does not contain what he is asking about rather than guessing. Do not invent facts, prices, cases or commitments. The goal is to win the deal by being useful to the client, so do not suggest pressure tactics or anything misleading.

Reply in the language Ivan writes in, which is usually Ukrainian. When he asks for a message, email or phrase meant for the client, write that text in the language the client communicates in, ready to send, with no placeholders in brackets, and keep any comment around it in Ivan's language. Ivan often dictates by voice, so read his messages by meaning and ignore recognition slips.

Your reply is shown as plain text in a narrow chat panel: use short paragraphs and simple dashes for lists, and no markdown headings, bold markers or tables.`

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY не налаштований' }, { status: 500 })
  const body = await req.json().catch(() => null)
  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  const messages: ChatMessage[] = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-30)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 8000) }))
  if (!leadId || messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'leadId and a user message are required' }, { status: 400 })
  }
  // The API expects the conversation to open with the user
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift()

  const context = await buildLeadContext(leadId)
  if (!context) return NextResponse.json({ error: 'Лід не знайдений' }, { status: 404 })

  const [{ data: lead }, { data: ov }, profile] = await Promise.all([
    supabaseAdmin.from('crm_leads').select('*').eq('id', leadId).maybeSingle(),
    supabaseAdmin.from('lead_ai_overviews').select('data').eq('lead_id', leadId).maybeSingle(),
    getAgencyProfile().catch(() => ''),
  ])
  const o = ov?.data as Record<string, unknown> | undefined
  const extra: string[] = []
  const facts = { ...((o?.facts as object) ?? {}), ...((lead?.qualification as object) ?? {}) }
  if (Object.keys(facts).length > 0) extra.push(`## Факти кваліфікації\n${JSON.stringify(facts, null, 1)}`)
  if (o && Array.isArray(o.factors)) {
    const rows = (o.factors as { key: string; level?: number; evidence?: string; gap?: string }[]).map(f => {
      const def = DEAL_FACTORS.find(d => d.key === f.key)
      const level = def && f.level != null ? def.levels[f.level]?.text : ''
      return `- ${def?.label ?? f.key}: ${level}. ${f.evidence ?? ''}${f.gap ? ` Бракує: ${f.gap}` : ''}`
    })
    extra.push(`## Поточна оцінка угоди: шанс закриття ${o.win_probability}%\n${rows.join('\n')}`)
    if (typeof o.next_step === 'string' && o.next_step) extra.push(`Наступний крок за оцінкою: ${o.next_step}`)
  }
  if (profile.trim()) extra.push(`## Що Gudrix може показати клієнту (кейси, матеріали)\n${profile.trim()}`)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const run = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 6000,
          system: [
            { type: 'text', text: ADVISOR },
            // Unchanged between turns of one conversation → served from cache
            {
              type: 'text',
              text: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n<lead_material>\n${context}\n\n${extra.join('\n\n')}\n</lead_material>`,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages,
        })
        run.on('text', delta => controller.enqueue(encoder.encode(delta)))
        await run.finalMessage()
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[Не вдалося отримати відповідь: ${(e as Error).message.slice(0, 200)}]`))
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
