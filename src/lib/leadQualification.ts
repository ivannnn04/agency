// Fact-based lead qualification: the SDR records facts on the lead card and
// the system counts the score. Each criterion sits in exactly one group —
// highly positive +25, slightly positive +10, negative −10 — and any
// negative disqualifies the lead unless an exception is recorded.

export interface Qualification {
  crunchbase?: string
  crunchbase_not_found?: boolean
  linkedin?: string
  research?: string
  scope?: string
  business_domain?: 'yes' | 'no'
  entity?: 'company' | 'individual'
  company_size?: '1-10' | '11-50' | '51-200' | '200+'
  contact_role?: 'ceo' | 'vp' | 'cmo' | 'cto' | 'assistant' | 'pm' | 'maker' | 'other'
  kpi?: string
  ready_3w?: 'yes' | 'no'
  old_client?: 'yes' | 'no'
  old_lead?: 'yes' | 'no'
  partnership?: 'client' | 'whitelabel' | 'selling'
  country?: string
  label_high?: 'yes' | 'no'
  expectations?: string
  override_reason?: string
  override_by?: string
  override_at?: string
}

export type QualKey = keyof Qualification

export const QUAL_OPTIONS = {
  business_domain: [['yes', 'Так, наш ICP'], ['no', 'Ні']],
  entity: [['company', 'Компанія'], ['individual', 'Приватна особа / фрилансер']],
  company_size: [['1-10', '1–10'], ['11-50', '11–50'], ['51-200', '51–200'], ['200+', '200+']],
  contact_role: [
    ['ceo', 'CEO / Founder'], ['vp', 'VP'], ['cmo', 'CMO'], ['cto', 'CTO'], ['assistant', 'Assistant'], ['pm', 'PM'],
    ['maker', 'Designer / Developer'], ['other', 'Інша роль'],
  ],
  ready_3w: [['yes', 'Так'], ['no', 'Ні']],
  old_client: [['yes', 'Так'], ['no', 'Ні']],
  old_lead: [['yes', 'Так'], ['no', 'Ні']],
  partnership: [['client', 'Звичайний клієнт'], ['whitelabel', 'WhiteLabel (роблять те саме, що ми)'], ['selling', 'Продають нам / менша компанія']],
  label_high: [['yes', 'HIGH'], ['no', '—']],
} as const

export type QualStatus = 'hot' | 'qualified' | 'nurture' | 'disqualified' | 'incomplete'

export const QUAL_STATUS: Record<QualStatus, { label: string; action: string; chip: string }> = {
  hot: { label: 'Hot', action: 'Дзвінок протягом 24 годин, CEO в курсі', chip: 'bg-red-50 text-red-600' },
  qualified: { label: 'Qualified', action: 'Стандартна передача в продаж', chip: 'bg-green-100 text-green-700' },
  nurture: { label: 'Nurture', action: 'Гріти, повернутись через 30 днів', chip: 'bg-amber-50 text-amber-700' },
  disqualified: { label: 'Disqualified', action: 'Ввічлива відмова або в базу на майбутнє', chip: 'bg-gray-100 text-gray-500' },
  incomplete: { label: 'Не заповнено', action: 'Заповни обовʼязкові поля — без них лід не йде в продаж', chip: 'bg-gray-100 text-gray-400' },
}

export interface QualResult {
  score: number
  raw: number
  status: QualStatus
  positives: { label: string; points: number }[]
  negatives: string[]
  missing: string[]
  overridden: boolean
}

const NEGATIVE_COUNTRIES = ['india', 'pakistan', 'china', 'philippines', 'індія', 'пакистан', 'китай', 'філіппіни']
// Every highly-positive slot a lead can fill: 18 × 25
const MAX_RAW = 450
const filled = (s: string | undefined | null) => !!s && s.trim().length > 0

export function qualify(
  lead: { email?: string | null; amount?: number | null; channel?: string | null },
  q: Qualification,
  probability: number | null,
): QualResult {
  const positives: QualResult['positives'] = []
  const negatives: string[] = []
  const missing: string[] = []
  const hi = (label: string) => positives.push({ label, points: 25 })
  const lo = (label: string) => positives.push({ label, points: 10 })

  const channel = (lead.channel ?? '').toLowerCase()
  if (/behance|dribbble/.test(channel)) hi(`Джерело: ${lead.channel}`)
  else if (/website|сайт/.test(channel)) lo(`Джерело: ${lead.channel}`)

  // Research data — required
  if (filled(q.crunchbase)) hi('Є посилання на Crunchbase')
  else if (q.crunchbase_not_found) negatives.push('Crunchbase: перевірено, компанію не знайдено')
  else missing.push('Crunchbase')
  if (filled(q.linkedin)) hi('Є LinkedIn компанії'); else missing.push('LinkedIn компанії')
  if (filled(q.research)) hi('Ресерч зроблено'); else missing.push('Ресерч')
  if (filled(q.scope) && !/^інформації немає/i.test(q.scope!.trim())) hi('Обсяг робіт описано'); else missing.push('Обсяг робіт')
  if (filled(lead.email)) hi('Є email'); else missing.push('Email')

  // Company profile — required
  if (q.business_domain === 'yes') hi('Наш ICP')
  else if (q.business_domain === 'no') negatives.push('Не наш ICP')
  else missing.push('Чи наш ICP')
  if (q.entity === 'company') hi('Компанія')
  else if (q.entity === 'individual') negatives.push('Приватна особа або фрилансер')
  else missing.push('Компанія чи приватна особа')
  if (q.company_size === '51-200' || q.company_size === '200+') hi(`Розмір компанії ${q.company_size}`)
  else if (q.company_size === '11-50') lo('Розмір компанії 11–50')
  else if (q.company_size === '1-10') negatives.push('Компанія 1–10 людей — замала під наш чек')
  else missing.push('Розмір компанії')
  if (lead.amount == null) missing.push('Сума угоди')
  else if (lead.amount >= 5000) hi('Сума угоди від 5000')
  else if (lead.amount >= 1000) lo('Сума угоди від 1000')
  else negatives.push('Сума угоди нижча за 1000')
  if (probability != null && probability >= 50) hi('Шанс закриття від 50%')

  // Contact person — required
  if (q.contact_role === 'ceo' || q.contact_role === 'vp' || q.contact_role === 'cmo') hi('Контакт приймає рішення')
  else if (q.contact_role === 'cto' || q.contact_role === 'assistant' || q.contact_role === 'pm') lo('Контакт впливає на рішення')
  else if (q.contact_role === 'maker') negatives.push('Контакт — дизайнер або розробник, не вирішує про бюджет')
  else if (!q.contact_role) missing.push('Роль контактної особи')

  // Quality of qualification — required
  if (filled(q.kpi)) hi('Знаємо KPI клієнта для проєкту'); else missing.push('KPI клієнта')
  if (q.ready_3w === 'yes') hi('Підтвердив інтерес, готовий стартувати за 1–3 тижні')
  else if (q.ready_3w === 'no') negatives.push('Немає наміру стартувати найближчі 1–3 тижні')
  else missing.push('Готовність стартувати за 1–3 тижні')
  if (!filled(q.expectations)) missing.push('Відповідь на «Що ви очікуєте від цього проєкту?»')

  // History and partnership
  if (q.old_client === 'yes') hi('Колишній клієнт')
  if (q.old_lead === 'yes') hi('Колишній лід')
  if (q.partnership === 'client') hi('Звичайний клієнт, не партнерство')
  else if (q.partnership === 'whitelabel') lo('WhiteLabel-партнерство')
  else if (q.partnership === 'selling') negatives.push('Вони продають нам, а не ми їм')
  if (q.label_high === 'yes') hi('Мітка HIGH')
  if (filled(q.country) && NEGATIVE_COUNTRIES.some(c => q.country!.toLowerCase().includes(c))) negatives.push(`Географія поза ICP: ${q.country}`)

  const raw = positives.reduce((s, p) => s + p.points, 0) - negatives.length * 10
  const score = Math.max(0, Math.min(100, Math.round((raw / MAX_RAW) * 100)))
  const overridden = negatives.length > 0 && filled(q.override_reason)
  const band: QualStatus = score >= 75 ? 'hot' : score >= 50 ? 'qualified' : score >= 30 ? 'nurture' : 'disqualified'
  // A lead with a required field still empty is not judged yet: it cannot
  // be handed to sales until the card is filled in
  const status: QualStatus = negatives.length > 0 && !overridden ? 'disqualified' : missing.length > 0 ? 'incomplete' : band
  return { score, raw, status, positives, negatives, missing, overridden }
}

// Facts the lead's manager entered win over what AI read out of the calls
export function mergeFacts(manual: Qualification | null | undefined, ai: Qualification | null | undefined): Qualification {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ai ?? {})) if (v !== null && v !== undefined && v !== '') out[k] = v
  for (const [k, v] of Object.entries(manual ?? {})) if (v !== null && v !== undefined && v !== '') out[k] = v
  return out as Qualification
}
