// The scorecard behind a lead's win probability. Each factor is scored 0–100
// from the evidence and contributes its weight × score; the weights add up to
// 100, so the probability is simply the sum of the points earned.

export type FactorKey =
  | 'need' | 'budget' | 'authority' | 'engagement' | 'fit' | 'competition' | 'objections' | 'momentum'

export const DEAL_FACTORS: { key: FactorKey; label: string; weight: number; asks: string }[] = [
  { key: 'need', label: 'Потреба і терміновість', weight: 15, asks: 'Is there a concrete problem the client must solve, and a reason to solve it now (a deadline, a launch, a cost of waiting)?' },
  { key: 'budget', label: 'Бюджет', weight: 15, asks: 'Has the client named a budget or reacted to a price, and does it fit the work?' },
  { key: 'authority', label: 'Хто приймає рішення', weight: 15, asks: 'Is Ivan talking to the person who decides, and is the decision process known (who else, by when)?' },
  { key: 'engagement', label: 'Залученість клієнта', weight: 15, asks: 'How much effort the client invests: replies, calls attended, materials shared, questions asked, initiative shown.' },
  { key: 'fit', label: 'Наша відповідність задачі', weight: 10, asks: 'How well what the client needs matches what Gudrix does, and whether the client has seen proof of it.' },
  { key: 'competition', label: 'Конкуренція', weight: 10, asks: 'Is the client comparing other agencies or freelancers, and where does Gudrix stand among them? 100 means no real alternative.' },
  { key: 'objections', label: 'Сумніви та заперечення', weight: 10, asks: 'Concerns the client raised (price, timing, trust, scope) and whether they were resolved. 100 means none remain open.' },
  { key: 'momentum', label: 'Наступний крок і темп', weight: 10, asks: 'Is a concrete next step agreed with a date, and how recent is the last contact?' },
]

export interface FactorScore { key: FactorKey; score: number; evidence: string; gap: string }
export interface Lever { action: string; factor: FactorKey; uplift: number; why: string }

export const factorPoints = (f: FactorScore) => {
  const w = DEAL_FACTORS.find(d => d.key === f.key)?.weight ?? 0
  return Math.round((w * f.score) / 10) / 10
}

export function probabilityFrom(factors: FactorScore[]): number {
  const total = factors.reduce((s, f) => s + (DEAL_FACTORS.find(d => d.key === f.key)?.weight ?? 0) * f.score / 100, 0)
  return Math.max(2, Math.min(97, Math.round(total)))
}
