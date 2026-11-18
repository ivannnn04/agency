import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { leadMeetingsSection, leadSection } from '@/lib/salesContext'

// AI deal overview for a CRM lead: how likely we are to win and what still
// has to be clarified, grounded in everything stored about the lead — CRM
// fields, emails, outreach thread, Fellow calls and Sales AI rooms.

const MODEL = process.env.LEAD_AI_MODEL || 'claude-opus-5'

export interface LeadOverview {
  win_probability: number
  confidence: 'low' | 'medium' | 'high'
  summary: string
  positive_signals: string[]
  risks: string[]
  clarify: { question: string; why: string }[]
  fit_points: string[]
  next_step: string
}

const ANALYST = `You are a deal analyst for Ivan, the founder of Gudrix, a full-cycle UX/UI design and development agency. You are given everything Gudrix has on one sales lead: CRM fields, emails, the outreach thread, transcripts and AI notes of calls recorded by the Fellow notetaker, and notes from Ivan's sales assistant. Ivan reads your overview on the lead's card to decide where to spend effort and what to do next.

Assess the deal honestly. The win probability is your calibrated estimate, from 0 to 100, that this lead becomes a paying project. Base it on evidence in the material: an explicit need and urgency, a stated budget that fits, access to the person who decides, how engaged the client is, competing options, unresolved objections, and how recently they were in touch. A lead with one friendly call and no budget, timeline or decision process discussed is not a likely win, so do not inflate the number to be encouraging. Set confidence to low when there is little material (for example no calls yet), and say in the summary what the estimate rests on.

Write for a busy founder:
- summary: two to four sentences on where the deal stands and why the probability is what it is.
- positive_signals and risks: short, concrete points, each tied to something the client actually said or did. Up to five of each; fewer is fine.
- clarify: the questions Ivan still needs answered to qualify and win the deal, most important first, up to six. "question" is worded so Ivan can ask it as is, in the language the client communicates in. "why" explains in Ukrainian what the answer unlocks.
- fit_points: how Gudrix can show it is the best fit for this particular client, tied to the needs and worries they voiced. Use only capabilities, cases and facts that appear in the material; where proof is missing, say what Ivan should prepare or send instead of inventing it. Up to five.
- next_step: the single most valuable next action, specific enough to do today.

Everything except "question" is in Ukrainian. Do not invent facts, numbers, names or commitments. Call transcripts are automatic, so read obvious recognition errors by meaning.`

export async function buildLeadContext(leadId: string): Promise<string | null> {
  const lead = await leadSection(leadId)
  if (!lead) return null
  const parts = [lead]

  const meetings = await leadMeetingsSection(leadId, 250_000).catch(() => null)
  if (meetings) parts.push(meetings)

  // Sales AI rooms linked to this lead: Ivan's brief, added materials, live-call debriefs
  const { data: rooms } = await supabaseAdmin.from('sales_rooms').select('id, name, about').eq('lead_id', leadId)
  for (const room of rooms ?? []) {
    if (room.about?.trim()) parts.push(`## Бриф Івана (Sales AI, «${room.name}»)\n${room.about.trim()}`)
    const { data: docs } = await supabaseAdmin
      .from('sales_docs')
      .select('kind, title, content, summary, created_at')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
    for (const d of docs ?? []) {
      const body = d.summary?.trim() || (d.content ?? '').trim().slice(0, 30_000)
      if (body) parts.push(`## ${d.kind === 'meeting' ? 'Дзвінок (Sales AI)' : 'Матеріал'}: ${d.title} (${(d.created_at ?? '').slice(0, 10)})\n${body}`)
    }
  }
  return parts.join('\n\n')
}

const strings = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).map(x => String(x ?? '').trim()).filter(Boolean).slice(0, max)

export async function generateLeadOverview(leadId: string): Promise<LeadOverview> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не налаштований')
  const context = await buildLeadContext(leadId)
  if (!context) throw new Error('Лід не знайдений')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const list = { type: 'array' as const, items: { type: 'string' as const } }
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: ANALYST,
    tools: [{
      name: 'deal_overview',
      description: 'Report the overview of this deal.',
      input_schema: {
        type: 'object',
        properties: {
          win_probability: { type: 'integer', description: 'Calibrated chance of winning the deal, 0-100' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          summary: { type: 'string' },
          positive_signals: list,
          risks: list,
          clarify: {
            type: 'array',
            items: {
              type: 'object',
              properties: { question: { type: 'string' }, why: { type: 'string' } },
              required: ['question', 'why'],
            },
          },
          fit_points: list,
          next_step: { type: 'string' },
        },
        required: ['win_probability', 'confidence', 'summary', 'positive_signals', 'risks', 'clarify', 'fit_points', 'next_step'],
      },
    }],
    tool_choice: { type: 'tool', name: 'deal_overview' },
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n<lead_material>\n${context}\n</lead_material>`,
    }],
  })

  const tu = msg.content.find(b => b.type === 'tool_use')
  const raw = (tu && tu.type === 'tool_use' ? tu.input : {}) as Record<string, unknown>
  const p = Number(raw.win_probability)
  if (!Number.isFinite(p) || !String(raw.summary ?? '').trim()) throw new Error('Модель не повернула огляд')

  const overview: LeadOverview = {
    win_probability: Math.max(0, Math.min(100, Math.round(p))),
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    summary: String(raw.summary).trim(),
    positive_signals: strings(raw.positive_signals, 5),
    risks: strings(raw.risks, 5),
    clarify: (Array.isArray(raw.clarify) ? raw.clarify : [])
      .map(c => ({ question: String(c?.question ?? '').trim(), why: String(c?.why ?? '').trim() }))
      .filter(c => c.question)
      .slice(0, 6),
    fit_points: strings(raw.fit_points, 5),
    next_step: String(raw.next_step ?? '').trim(),
  }

  const { error } = await supabaseAdmin
    .from('lead_ai_overviews')
    .upsert({ lead_id: leadId, data: overview, generated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  return overview
}
