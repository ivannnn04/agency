import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { buildLeadContext } from '@/lib/leadInsight'

// Letter-by-letter coaching on a lead's correspondence: was what we sent the
// right move, and what is the best answer to what the client wrote.

const MODEL = process.env.LEAD_AI_MODEL || 'claude-opus-5'
const MAX_LETTERS = 15

export interface EmailReview {
  // outgoing
  verdict?: 'strong' | 'ok' | 'weak'
  note?: string
  better?: string
  // incoming
  signal?: string
  reply_tip?: string
  reply_draft?: string
  at: string
}

const COACH = `You coach Ivan, the founder of Gudrix, a full-cycle UX/UI design and development agency, on his email correspondence with one sales lead. The goal of every letter is to move this lead toward buying by being useful to them, so judge and advise with that in mind. You are given everything Gudrix has on the lead (CRM fields, the whole correspondence, the outreach thread, call notes and transcripts) and then a numbered list of the letters to review.

Review each letter in the context of the thread at the moment it was written: what had been said before it, on calls and in writing, and what came after.

For a letter Gudrix sent (outgoing):
- verdict: strong when it clearly moves the deal forward, ok when it is fine but adds little, weak when it risks cooling the lead or wastes a touch.
- note: one or two sentences on why. Look at timing and spacing against the other letters and calls, length, whether it answers what this client actually cares about, whether it carries a clear and easy next step, and whether it reads as specific to them or as generic or needy. Several letters sent close together with no reply in between is itself worth naming.
- better: the one change that would have made it stronger, or what the next letter should add to make up for it. Leave empty when nothing is worth changing.

For a letter the client sent (incoming):
- signal: one sentence on what the client is telling us: a buying signal, a hesitation, a question, a brush-off, and how warm it is.
- reply_tip: one or two sentences on how to answer so the lead gets warmer: what to acknowledge, what to offer, which next step to propose.
- reply_draft: a reply Ivan can send as is, in the language the client writes in, in a natural first-person voice, short, ending in one concrete next step. No placeholders in brackets; when a detail is unknown, write around it. If a later letter in the thread already answered this one well, say so in reply_tip and leave reply_draft empty.

Be direct: Ivan wants to know when a letter was a mistake. Write note, better, signal and reply_tip in Ukrainian. Do not invent facts, prices, cases or commitments that are not in the material.`

export async function reviewLeadEmails(leadId: string, force = false): Promise<{ reviewed: number }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не налаштований')

  const { data: rows, error } = await supabaseAdmin
    .from('lead_emails')
    .select('id, direction, subject, body, sent_at, ai_review')
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: true })
  if (error) throw new Error(error.message)

  // Newest letters first in line; older ones keep the review they have
  const targets = (rows ?? []).filter(r => force || !r.ai_review).slice(-MAX_LETTERS)
  if (targets.length === 0) return { reviewed: 0 }

  const context = await buildLeadContext(leadId)
  if (!context) throw new Error('Лід не знайдений')

  const letters = targets
    .map((r, i) => `<letter n="${i + 1}" direction="${r.direction === 'in' ? 'incoming' : 'outgoing'}" sent="${r.sent_at}">\nSubject: ${r.subject ?? ''}\n\n${(r.body ?? '').slice(0, 6000)}\n</letter>`)
    .join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: 16000,
      system: COACH,
      tools: [{
        name: 'letter_reviews',
        description: 'Report the review of every numbered letter.',
        input_schema: {
          type: 'object',
          properties: {
            reviews: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  n: { type: 'integer', description: 'The letter number' },
                  verdict: { type: 'string', enum: ['strong', 'ok', 'weak'] },
                  note: { type: 'string' },
                  better: { type: 'string' },
                  signal: { type: 'string' },
                  reply_tip: { type: 'string' },
                  reply_draft: { type: 'string' },
                },
                required: ['n'],
              },
            },
          },
          required: ['reviews'],
        },
      }],
      tool_choice: { type: 'tool', name: 'letter_reviews' },
      messages: [{
        role: 'user',
        content: `Today is ${new Date().toISOString().slice(0, 10)}. Letter times are in UTC.\n\n<lead_material>\n${context}\n</lead_material>\n\n<letters_to_review>\n${letters}\n</letters_to_review>`,
      }],
    })
    .finalMessage()
  if (msg.stop_reason === 'max_tokens') throw new Error('Відповідь моделі обрізана — спробуй ще раз')

  const tu = msg.content.find(b => b.type === 'tool_use')
  const reviews = ((tu && tu.type === 'tool_use' ? (tu.input as { reviews?: unknown }).reviews : []) ?? []) as Record<string, unknown>[]
  const text = (v: unknown) => String(v ?? '').trim()
  const at = new Date().toISOString()

  let reviewed = 0
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const target = targets[Number(r?.n) - 1]
    if (!target) continue
    // Keep only the fields that belong to the letter's direction
    const review: EmailReview = target.direction === 'in'
      ? { signal: text(r.signal), reply_tip: text(r.reply_tip), reply_draft: text(r.reply_draft), at }
      : {
          verdict: r.verdict === 'strong' || r.verdict === 'weak' ? r.verdict : 'ok',
          note: text(r.note),
          better: text(r.better),
          at,
        }
    if (!(review.signal || review.reply_tip || review.note)) continue
    const { error: upErr } = await supabaseAdmin.from('lead_emails').update({ ai_review: review }).eq('id', target.id)
    if (upErr) throw new Error(upErr.message)
    reviewed++
  }
  return { reviewed }
}
