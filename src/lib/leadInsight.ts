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
  call_agenda: { topic: string; goal: string }[]
  message_draft: string
  materials: { what: string; why: string }[]
  version: number
}

// Bumped when the overview gains sections, so older stored ones get refreshed
export const OVERVIEW_VERSION = 2
const PROFILE_KEY = 'agency_profile'

export async function getAgencyProfile(): Promise<string> {
  const { data } = await supabaseAdmin.from('integration_state').select('value').eq('key', PROFILE_KEY).maybeSingle()
  return String(data?.value?.text ?? '')
}

export async function setAgencyProfile(text: string) {
  const { error } = await supabaseAdmin
    .from('integration_state')
    .upsert({ key: PROFILE_KEY, value: { text: text.slice(0, 20_000) }, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

const ANALYST = `You are a deal analyst for Ivan, the founder of Gudrix, a full-cycle UX/UI design and development agency. You are given everything Gudrix has on one sales lead: CRM fields, emails, the outreach thread, transcripts and AI notes of calls recorded by the Fellow notetaker, and notes from Ivan's sales assistant. You may also be given an agency profile listing what Gudrix can show a client: case studies, links, decks and other materials. Ivan reads your overview on the lead's card to decide where to spend effort and exactly what to do next.

Assess the deal honestly. The win probability is your calibrated estimate, from 0 to 100, that this lead becomes a paying project. Base it on evidence in the material: an explicit need and urgency, a stated budget that fits, access to the person who decides, how engaged the client is, competing options, unresolved objections, and how recently they were in touch. A lead with one friendly call and no budget, timeline or decision process discussed is not a likely win, so do not inflate the number to be encouraging. Set confidence to low when there is little material (for example only an outreach proposal and no reply or call yet), and say in the summary what the estimate rests on. For a lead with almost no material, still give useful preparation: what to find out first and how to open the conversation.

Write for a busy founder. Keep every item short and concrete:
- summary: two to four sentences on where the deal stands and why the probability is what it is.
- next_step: the single most valuable next action, specific enough to do today.
- call_agenda: the topics to cover on the next call with this lead, in the order Ivan should raise them, up to six. "topic" is a short title; "goal" says what Ivan needs to get out of that part of the call.
- clarify: the questions Ivan still needs answered to qualify and win the deal, most important first, up to six. "question" is worded so Ivan can ask it as is, in the language the client communicates in. "why" explains what the answer unlocks.
- message_draft: a message Ivan can send to the lead right now, in writing, in the language the client communicates in and in a natural first-person voice. It moves the deal forward and includes the two or three questions that work well in text. No placeholders in brackets; if a detail is unknown, write around it.
- materials: what Ivan can send to strengthen the lead's interest and show Gudrix is the right choice, up to five. "what" names the material; "why" ties it to something this client said or needs. Prefer items from the agency profile and artefacts already made for this client. When the right asset is not in the material you were given, describe it as something to prepare (for example a short recorded walkthrough or a one-page scope) and never invent a case study, a client name, a result or a link.
- fit_points: how Gudrix can show it is the best fit for this particular client, tied to the needs and worries they voiced. Up to five.
- positive_signals and risks: short points, each tied to something the client actually said or did. Up to five of each; fewer is fine.

Write "question" and "message_draft" in the client's language and everything else in Ukrainian. Do not invent facts, numbers, names or commitments. Call transcripts are automatic, so read obvious recognition errors by meaning.`

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

function pairList<A extends string, B extends string>(v: unknown, a: A, b: B, max: number) {
  return (Array.isArray(v) ? v : [])
    .map(x => ({ [a]: String(x?.[a] ?? '').trim(), [b]: String(x?.[b] ?? '').trim() }) as Record<A | B, string>)
    .filter(x => x[a])
    .slice(0, max)
}

export async function generateLeadOverview(leadId: string): Promise<LeadOverview> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не налаштований')
  const context = await buildLeadContext(leadId)
  if (!context) throw new Error('Лід не знайдений')

  const profile = await getAgencyProfile().catch(() => '')
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const list = { type: 'array' as const, items: { type: 'string' as const } }
  const pairs = (a: string, b: string) => ({
    type: 'array' as const,
    items: {
      type: 'object' as const,
      properties: { [a]: { type: 'string' as const }, [b]: { type: 'string' as const } },
      required: [a, b],
    },
  })
  // Streamed: the answer is long and mostly Cyrillic, which is token-heavy
  const msg = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: 16000,
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
            next_step: { type: 'string' },
            call_agenda: pairs('topic', 'goal'),
            clarify: pairs('question', 'why'),
            message_draft: { type: 'string' },
            materials: pairs('what', 'why'),
            fit_points: list,
            positive_signals: list,
            risks: list,
          },
          required: [
            'win_probability', 'confidence', 'summary', 'next_step', 'call_agenda', 'clarify', 'message_draft',
            'materials', 'fit_points', 'positive_signals', 'risks',
          ],
        },
      }],
      tool_choice: { type: 'tool', name: 'deal_overview' },
      messages: [{
        role: 'user',
        content:
          `Today is ${new Date().toISOString().slice(0, 10)}.\n\n` +
          (profile.trim() ? `<agency_profile>\n${profile.trim()}\n</agency_profile>\n\n` : '') +
          `<lead_material>\n${context}\n</lead_material>`,
      }],
    })
    .finalMessage()
  if (msg.stop_reason === 'max_tokens') throw new Error('Відповідь моделі обрізана — спробуй ще раз')

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
    clarify: pairList(raw.clarify, 'question', 'why', 6),
    fit_points: strings(raw.fit_points, 5),
    next_step: String(raw.next_step ?? '').trim(),
    call_agenda: pairList(raw.call_agenda, 'topic', 'goal', 6),
    message_draft: String(raw.message_draft ?? '').trim(),
    materials: pairList(raw.materials, 'what', 'why', 5),
    version: OVERVIEW_VERSION,
  }

  const { error } = await supabaseAdmin
    .from('lead_ai_overviews')
    .upsert({ lead_id: leadId, data: overview, generated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  return overview
}
