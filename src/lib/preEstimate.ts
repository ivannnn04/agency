// Automatic pre-estimates for newly created tasks.
//
// People forget to set estimates, so every new task gets one suggested from
// its title via the keyword rules below. It's only a starting point — the
// estimate stays fully editable in the task panel and the workload view.
//
// TODO: these hours are provisional defaults. Replace them with the exact
// values from the Gudrix estimation doc (Notion) once its content is provided.

type Rule = { keywords: string[]; hours: number }

// First matching rule wins — keep more specific entries above generic ones.
const RULES: Rule[] = [
  { keywords: ['дзвінок', 'дзвінки', 'зустріч', 'call', 'meeting', 'sync', 'мітинг', 'дейлі', 'daily'], hours: 1 },
  { keywords: ["рев'ю", 'ревью', 'review', 'фідбек', 'feedback'], hours: 1 },
  { keywords: ['правки', 'правк', 'фікс', 'fix', 'edits'], hours: 2 },
  { keywords: ['мудборд', 'moodboard', 'mood board'], hours: 3 },
  { keywords: ['референс', 'research', 'аналіз', 'дослідж'], hours: 3 },
  { keywords: ['юзерфлоу', 'user flow', 'userflow', 'флоу'], hours: 4 },
  { keywords: ['вайрфрейм', 'wireframe'], hours: 6 },
  { keywords: ['прототип', 'prototype'], hours: 6 },
  { keywords: ['ui kit', 'ui-kit', 'дизайн-систем', 'design system'], hours: 16 },
  { keywords: ['брендинг', 'branding', 'айдентика', 'identity'], hours: 24 },
  { keywords: ['логотип', 'лого', 'logo'], hours: 12 },
  { keywords: ['лендінг', 'landing'], hours: 16 },
  { keywords: ['дашборд', 'dashboard'], hours: 16 },
  { keywords: ['мобільн', 'mobile app'], hours: 24 },
  { keywords: ['головна', 'homepage', 'home page'], hours: 12 },
  { keywords: ['презентація', 'presentation', 'pitch'], hours: 8 },
  { keywords: ['анімація', 'animation', 'motion'], hours: 8 },
  { keywords: ['ілюстрація', 'illustration'], hours: 6 },
  { keywords: ['іконк', 'icon'], hours: 4 },
  { keywords: ['банер', 'banner', 'креатив', 'creative'], hours: 2 },
  { keywords: ['пост', 'сторіс', 'stories', 'social'], hours: 2 },
  { keywords: ['сторінка', 'page', 'екран', 'screen'], hours: 6 },
]

export function suggestEstimate(title: string): number | null {
  const t = title.toLowerCase()
  for (const rule of RULES) {
    if (rule.keywords.some(k => t.includes(k))) return rule.hours
  }
  return null
}
