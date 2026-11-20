// The scorecard behind a lead's win probability. Every factor is a ladder of
// explicit levels: the level a deal has reached decides its points, so the
// same facts always give the same score. The weights add up to 100, and the
// probability is the sum of the points earned.

export type FactorKey =
  | 'need' | 'budget' | 'authority' | 'engagement' | 'fit' | 'competition' | 'objections' | 'momentum'

export interface FactorLevel { share: number; text: string }

export const OVERVIEW_VERSION = 4

// What "fit" is checked against: one quarter of the factor per item met
export const FIT_CHECKS: { key: 'profile' | 'case' | 'offer' | 'team'; label: string }[] = [
  { key: 'profile', label: 'задача в нашому профілі' },
  { key: 'case', label: 'є релевантний кейс, і клієнт його бачив' },
  { key: 'offer', label: 'є чіткий офер під їхню задачу' },
  { key: 'team', label: 'є команда з потрібними навичками й доступністю' },
]

export const DEAL_FACTORS: { key: FactorKey; label: string; weight: number; levels: FactorLevel[] }[] = [
  {
    key: 'need', label: 'Потреба і терміновість', weight: 15,
    levels: [
      { share: 0, text: 'Потреби немає або клієнт «просто дивиться»' },
      { share: 0.27, text: 'Потреба є, але розмита; терміни не обговорювали' },
      { share: 0.53, text: 'Конкретна потреба, але старт пізніше ніж за 3 тижні або термін не підтверджено' },
      { share: 1, text: 'Конкретна потреба, і клієнт підтвердив готовність стартувати протягом 3 тижнів' },
    ],
  },
  {
    key: 'budget', label: 'Бюджет', weight: 15,
    levels: [
      { share: 0, text: 'Бюджет явно не відповідає обсягу або нижчий за наш мінімум' },
      { share: 0.33, text: 'Бюджет не обговорювали, орієнтиру немає' },
      { share: 0.67, text: 'Є орієнтир: діапазон від клієнта або оцінка за розміром компанії чи Crunchbase' },
      { share: 1, text: 'Клієнт назвав або підтвердив суму, і вона відповідає обсягу' },
    ],
  },
  {
    key: 'authority', label: 'Хто приймає рішення', weight: 15,
    levels: [
      { share: 0, text: 'Контакт не впливає на рішення або вирішує великий комітет (5+ людей)' },
      { share: 0.33, text: 'Хто і як вирішує — невідомо' },
      { share: 0.67, text: 'Відомо, хто вирішує (2–4 людини), але не всі були на звʼязку' },
      { share: 1, text: 'Говоримо з усіма, хто вирішує (1–2 людини); процес і дата рішення відомі' },
    ],
  },
  {
    key: 'engagement', label: 'Залученість клієнта', weight: 15,
    levels: [
      { share: 0, text: 'Не відповідає або не прийшов на дзвінок' },
      { share: 0.25, text: 'Відповів або прийшов на дзвінок, але пасивний' },
      { share: 0.5, text: 'Ставив питання по суті' },
      { share: 0.75, text: 'Ставив більше питань, ніж ми, і ділився матеріалами' },
      { share: 1, text: 'Прийшов із брифом і сам презентував проєкт; сам попросив пропозицію або ініціював наступну зустріч' },
    ],
  },
  {
    key: 'fit', label: 'Наша відповідність задачі', weight: 10,
    levels: [0, 1, 2, 3, 4].map(n => ({ share: n / 4, text: `Виконано ${n} з 4: профіль, кейс, офер, команда` })),
  },
  {
    key: 'competition', label: 'Конкуренція', weight: 10,
    levels: [
      { share: 0, text: 'Клієнт схиляється до іншого виконавця' },
      { share: 0.33, text: 'Порівнює з іншими (або це невідомо), наша позиція незрозуміла' },
      { share: 0.67, text: 'Порівнює, але сам назвав нас фаворитом або ми закриваємо його критерії вибору' },
      { share: 1, text: 'Не порівнює — ми єдиний варіант' },
    ],
  },
  {
    key: 'objections', label: 'Сумніви та заперечення', weight: 10,
    levels: [
      { share: 0, text: 'Три і більше відкритих заперечень' },
      { share: 0.25, text: 'Два відкриті заперечення' },
      { share: 0.5, text: 'Одне відкрите заперечення, або розмови по суті ще не було' },
      { share: 1, text: 'Відкритих заперечень немає' },
    ],
  },
  {
    key: 'momentum', label: 'Наступний крок і темп', weight: 10,
    levels: [
      { share: 0, text: 'Тиша понад 30 днів або клієнт перестав відповідати' },
      { share: 0.3, text: 'Наступного кроку немає; останній контакт до 30 днів тому' },
      { share: 0.6, text: 'Наступний крок є, але без дати, або контакт був 8–14 днів тому' },
      { share: 1, text: 'Наступний крок узгоджено з датою, контакт був за останні 7 днів' },
    ],
  },
]

export interface FactorScore {
  key: FactorKey
  score: number
  evidence: string
  gap: string
  level?: number
  details?: string[]
}
export interface Lever { action: string; factor: FactorKey; uplift: number; why: string }

const defOf = (key: FactorKey) => DEAL_FACTORS.find(d => d.key === key)

export const factorPoints = (f: FactorScore) => Math.round(((defOf(f.key)?.weight ?? 0) * f.score) / 10) / 10

export function probabilityFrom(factors: FactorScore[]): number {
  const total = factors.reduce((s, f) => s + (defOf(f.key)?.weight ?? 0) * f.score / 100, 0)
  return Math.max(2, Math.min(97, Math.round(total)))
}

// What the next rung of a factor's ladder is and how many points it adds
export function nextLevel(f: FactorScore): { text: string; gain: number } | null {
  const def = defOf(f.key)
  if (!def || f.level == null || f.level >= def.levels.length - 1) return null
  const next = def.levels[f.level + 1]
  return { text: next.text, gain: Math.round(def.weight * (next.share - def.levels[f.level].share) * 10) / 10 }
}
