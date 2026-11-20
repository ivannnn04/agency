import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { leadMeetingsSection, leadSection } from '@/lib/salesContext'
import { DEAL_FACTORS, FIT_CHECKS, FactorKey, FactorScore, Lever, OVERVIEW_VERSION, nextLevel, probabilityFrom } from '@/lib/dealFactors'
import { Qualification } from '@/lib/leadQualification'

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
  factors: FactorScore[]
  why_not_higher: string
  why_not_lower: string
  levers: Lever[]
  potential: number
  // Qualification facts read out of the calls and letters; the lead's own
  // fields win over these
  facts: Qualification
  // Probability after each evaluation, oldest first — the trend on the board
  history: { at: string; p: number }[]
  version: number
}

export { OVERVIEW_VERSION }
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

Assess the deal through a scorecard of eight factors. Each factor is a ladder of levels, listed lowest first and numbered from 0. For each factor pick the highest level whose description is fully supported by evidence in the material. A level is reached only by what the client said or did, never by a friendly tone or by what is likely; when a topic never came up, the right level is the one that says it is unknown or was not discussed. The win probability shown to Ivan is computed from the levels you pick, so do not aim for a total.

${DEAL_FACTORS.filter(f => f.key !== 'fit').map(f => `${f.key} — ${f.label}:\n${f.levels.map((l, i) => `  ${i}: ${l.text}`).join('\n')}`).join('\n\n')}

fit is not a ladder but four checks, each true only when the material shows it: ${FIT_CHECKS.map(c => `${c.key} (${c.label})`).join('; ')}. "case" and "offer" are true only if the client has actually been shown or sent them.

For objections, also list every concern the client raised that is still unresolved in "open_concerns", each as a short phrase. A concern Ivan answered and the client accepted is not open.

For each factor give "evidence", one sentence naming what the level rests on (a quote, a fact, a date, or plainly that it was never discussed), and "gap", what exactly is missing to reach the next level, or an empty string at the top level.

Then explain the result:
- why_not_higher: one or two sentences on what holds the probability down the most.
- why_not_lower: one or two sentences on what keeps it from being lower.
- levers: the moves that would lift a factor to its next level, most valuable first, up to five, at most one per factor. Each names the concrete "action" Ivan takes, the "factor" it lifts, and "why" it works for this client. The gain in points is computed from the ladder, so do not state one. Give real moves specific to this deal, such as getting the co-founder on a call or sending a fixed-price phase one before the client's stated decision date, and skip generic advice like "follow up" or "build trust".

Also record the qualification facts you can read directly from the material in "facts". Fill a field only when the material states it; leave out anything you would have to guess, because these facts feed a formal score. Fields: entity (company or individual), company_size (1-10, 11-50, 51-200, 200+), contact_role (ceo for a CEO or founder, vp, cmo, cto, assistant, pm, maker for a designer or developer, other), ready_3w (yes if the client confirmed they want to start within three weeks, no if they said later or showed no intent to start), country, kpi (the business result the client wants from this project, in their words), expectations (their answer to what they expect from the project, as close to verbatim as the material allows), scope (what has to be designed or built, one or two sentences).

Set confidence to low when there is little material (for example only an outreach proposal and no reply or call yet), and say in the summary what the estimate rests on. For a lead with almost no material, still give useful preparation: what to find out first and how to open the conversation.

Write for a busy founder. Keep every item short and concrete:
- summary: two to four sentences on where the deal stands. Do not state a percentage in it; the number is computed from the scorecard.
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

const FACTOR_KEYS = DEAL_FACTORS.map(f => f.key)

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
            factors: {
              type: 'array',
              description: 'All eight factors. "level" is the index of the ladder level reached (ignored for fit).',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', enum: FACTOR_KEYS },
                  level: { type: 'integer' },
                  evidence: { type: 'string' },
                  gap: { type: 'string' },
                },
                required: ['key', 'level', 'evidence', 'gap'],
              },
            },
            fit_checks: {
              type: 'object',
              properties: Object.fromEntries(FIT_CHECKS.map(c => [c.key, { type: 'boolean' as const }])),
              required: FIT_CHECKS.map(c => c.key),
            },
            open_concerns: list,
            facts: {
              type: 'object',
              properties: {
                entity: { type: 'string', enum: ['company', 'individual'] },
                company_size: { type: 'string', enum: ['1-10', '11-50', '51-200', '200+'] },
                contact_role: { type: 'string', enum: ['ceo', 'vp', 'cmo', 'cto', 'assistant', 'pm', 'maker', 'other'] },
                ready_3w: { type: 'string', enum: ['yes', 'no'] },
                country: { type: 'string' },
                kpi: { type: 'string' },
                expectations: { type: 'string' },
                scope: { type: 'string' },
              },
            },
            why_not_higher: { type: 'string' },
            why_not_lower: { type: 'string' },
            levers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string' },
                  factor: { type: 'string', enum: FACTOR_KEYS },
                  why: { type: 'string' },
                },
                required: ['action', 'factor', 'why'],
              },
            },
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
            'factors', 'fit_checks', 'open_concerns', 'facts', 'why_not_higher', 'why_not_lower', 'levers', 'confidence', 'summary', 'next_step', 'call_agenda', 'clarify', 'message_draft',
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
  const rawFactors = (Array.isArray(raw.factors) ? raw.factors : []) as Record<string, unknown>[]
  if (rawFactors.length === 0 || !String(raw.summary ?? '').trim()) throw new Error('Модель не повернула огляд')

  const checks = (raw.fit_checks ?? {}) as Record<string, unknown>
  const concerns = strings(raw.open_concerns, 8)

  // Points come from the ladder, not from the model: it only says which
  // level the evidence supports. A factor it skipped sits at the "unknown" level.
  const factors: FactorScore[] = DEAL_FACTORS.map(def => {
    const f = rawFactors.find(x => x?.key === def.key)
    const top = def.levels.length - 1
    let level = Math.max(0, Math.min(top, Math.round(Number(f?.level))))
    if (!Number.isFinite(level)) level = 1
    let details: string[] | undefined
    if (def.key === 'fit') {
      const met = FIT_CHECKS.filter(c => checks[c.key] === true)
      level = met.length
      details = FIT_CHECKS.map(c => `${checks[c.key] === true ? '✓' : '✗'} ${c.label}`)
    } else if (def.key === 'objections') {
      // The count of open concerns decides; with none listed the model's
      // choice between "no conversation yet" and "nothing open" stands
      if (concerns.length >= 3) level = 0
      else if (concerns.length === 2) level = 1
      else if (concerns.length === 1) level = 2
      else level = Math.max(level, 2)
      if (concerns.length > 0) details = concerns
    }
    return {
      key: def.key,
      level,
      score: Math.round(def.levels[level].share * 100),
      evidence: String(f?.evidence ?? '').trim() || 'Немає даних',
      gap: String(f?.gap ?? '').trim(),
      ...(details ? { details } : {}),
    }
  })
  const probability = probabilityFrom(factors)

  // A lever is worth exactly what the next level of its factor adds
  const levers: Lever[] = []
  const used = new Set<FactorKey>()
  for (const l of (Array.isArray(raw.levers) ? raw.levers : []) as Record<string, unknown>[]) {
    const key = l?.factor as FactorKey
    const action = String(l?.action ?? '').trim()
    const factor = factors.find(f => f.key === key)
    const next = factor ? nextLevel(factor) : null
    if (!action || !next || used.has(key) || levers.length >= 5) continue
    const uplift = Math.round(next.gain)
    if (uplift < 1) continue
    used.add(key)
    levers.push({ action, factor: key, uplift, why: String(l.why ?? '').trim() })
  }
  levers.sort((x, y) => y.uplift - x.uplift)

  const rawFacts = (raw.facts ?? {}) as Record<string, unknown>
  const facts: Qualification = {}
  for (const k of ['entity', 'company_size', 'contact_role', 'ready_3w', 'country', 'kpi', 'expectations', 'scope'] as const) {
    const v = String(rawFacts[k] ?? '').trim()
    if (v) (facts as Record<string, string>)[k] = v.slice(0, 600)
  }

  const { data: prev } = await supabaseAdmin.from('lead_ai_overviews').select('data').eq('lead_id', leadId).maybeSingle()
  const before = (Array.isArray(prev?.data?.history) ? prev.data.history : []) as LeadOverview['history']
  // An overview from before history was kept still gives one earlier point
  const seed = before.length === 0 && typeof prev?.data?.win_probability === 'number'
    ? [{ at: '', p: prev.data.win_probability as number }]
    : before
  const history = [...seed, { at: new Date().toISOString(), p: probability }].slice(-12)

  const overview: LeadOverview = {
    win_probability: probability,
    factors,
    why_not_higher: String(raw.why_not_higher ?? '').trim(),
    why_not_lower: String(raw.why_not_lower ?? '').trim(),
    levers,
    potential: Math.min(97, probability + levers.reduce((sum, l) => sum + l.uplift, 0)),
    facts,
    history,
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

// ── Design brief ("ТЗ") written as a prompt ──────────────────────────────────

const BRIEF_WRITER = `You write design briefs for Gudrix, a full-cycle UX/UI design and development agency. You are given everything Gudrix has on one sales lead: CRM fields, emails, the outreach thread, and transcripts and notes of calls. From it, write the technical task for the design work this client needs.

The brief is written as a prompt. Its reader is a designer, or an AI design tool, who has never heard of this client and will start designing from this text alone, so it must be self-contained. Address the reader directly ("You are designing…"), explain the reasons behind requirements so the reader can make good decisions where the brief is silent, and prefer specific statements over general ones.

Cover, in this order and under short plain headings:
1. Context: who the client is, what their product or business does, and why they are doing this project now.
2. Goal: what the design has to achieve for the business and how success will be judged.
3. Audience: who will use it, what they come to do, and what they care about.
4. Scope: the pages, screens, flows or assets to design, each with what it must contain and do. Separate what is in the first phase from what comes later when the client drew that line.
5. Functional requirements: behaviour, states, integrations, content sources, platforms and breakpoints.
6. Visual direction: brand assets that exist, the style the client asked for, references they liked or rejected, tone of voice.
7. Constraints: deadlines, budget frame, technology, things the client ruled out.
8. Deliverables: what Gudrix hands over and in what form.
9. Open questions: everything a designer would need that the material does not answer.

Take requirements only from the material, and keep the client's own wording for the things they were specific about. Where the material is silent, do not fill the gap with a plausible guess: put the point under Open questions, and when work cannot start without a decision, state the assumption you recommend and mark it clearly as an assumption. Leave out sales matters such as win probability or negotiation tactics. If the material says almost nothing about what to design, say so in one short paragraph and make the brief mostly the list of questions to ask the client.

Write plain text with simple headings and short paragraphs or lists, with no markdown tables. Call transcripts are automatic, so read obvious recognition errors by meaning.`

export interface LeadBrief { content: string; lang: 'en' | 'uk'; generated_at: string }

export async function getLeadBrief(leadId: string): Promise<LeadBrief | null> {
  const { data } = await supabaseAdmin
    .from('lead_briefs').select('content, lang, generated_at').eq('lead_id', leadId).maybeSingle()
  return (data as LeadBrief | null) ?? null
}

export async function generateLeadBrief(leadId: string, lang: 'en' | 'uk'): Promise<LeadBrief> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не налаштований')
  const context = await buildLeadContext(leadId)
  if (!context) throw new Error('Лід не знайдений')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: 12000,
      system: BRIEF_WRITER,
      messages: [{
        role: 'user',
        content:
          `<lead_material>\n${context}\n</lead_material>\n\n` +
          `Write the brief in ${lang === 'uk' ? 'Ukrainian' : 'English'}. Reply with the brief only, starting from its first line.`,
      }],
    })
    .finalMessage()
  const content = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  if (!content) throw new Error('Модель не повернула ТЗ')
  if (msg.stop_reason === 'max_tokens') throw new Error('ТЗ вийшло задовгим і обрізалось — спробуй ще раз')

  const brief: LeadBrief = { content, lang, generated_at: new Date().toISOString() }
  const { error } = await supabaseAdmin.from('lead_briefs').upsert({ lead_id: leadId, ...brief })
  if (error) throw new Error(error.message)
  return brief
}
