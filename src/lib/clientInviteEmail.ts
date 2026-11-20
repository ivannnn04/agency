// The email a client gets when the admin opens their workspace: a launch-day
// letter, not a system notification. Table layout and inline styles only —
// that is what email clients render reliably.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface ClientInviteInput {
  firstName: string
  projectNames: string[]
  inviteUrl: string
  loginUrl: string
  email: string
  lang: 'en' | 'uk'
}

interface Copy {
  subject: (project: string | null) => string
  preheader: string
  eyebrow: string
  headline: (name: string) => string
  intro: (project: string | null) => string
  ready: string
  features: [string, string][]
  cta: string
  ctaNote: string
  after: (loginUrl: string, email: string) => string
  signoff: string
  team: string
  ignore: string
}

const COPY: Record<'en' | 'uk', Copy> = {
  en: {
    subject: p => (p ? `🚀 Buckle up — ${p} is taking off` : '🚀 Buckle up — your project with Gudrix is taking off'),
    preheader: 'Congratulations on the kickoff! Your client workspace is ready — come on in.',
    eyebrow: 'Kickoff day',
    headline: n => (n ? `Buckle up, ${n}.<br>We’re taking off.` : 'Buckle up.<br>We’re taking off.'),
    intro: p => (p
      ? `Congratulations on the start of <b style="color:#ffffff">${p}</b>! We’re genuinely excited to build this with you — and today it officially begins.`
      : 'Congratulations on the start of your project! We’re genuinely excited to build this with you — and today it officially begins.'),
    ready: 'Your private workspace is ready. Everything about the project lives there, from the first step to the final handoff:',
    features: [
      ['Onboarding & roadmap', 'what happens, in what order, and when'],
      ['Live progress', 'tasks, timeline and deadlines, always up to date'],
      ['A direct line to the team', 'chat, notes, change requests and invoices in one place'],
    ],
    cta: 'Enter your workspace',
    ctaNote: 'One click to set your password — it takes ten seconds.',
    after: (url, email) => `After that, sign in any time at <a href="${url}" style="color:#9ca3af">${url.replace(/^https?:\/\//, '')}</a> with <b style="color:#d1d5db">${email}</b> and your password, or with Google using the same address.`,
    signoff: 'Let’s make something great.',
    team: 'The Gudrix team',
    ignore: 'If you weren’t expecting this email, you can safely ignore it.',
  },
  uk: {
    subject: p => (p ? `🚀 Пристебніться — ${p} злітає` : '🚀 Пристебніться — ваш проєкт із Gudrix злітає'),
    preheader: 'Вітаємо зі стартом! Ваш кабінет клієнта вже готовий — заходьте.',
    eyebrow: 'День старту',
    headline: n => (n ? `Пристебніться, ${n}.<br>Ми злітаємо.` : 'Пристебніться.<br>Ми злітаємо.'),
    intro: p => (p
      ? `Вітаємо зі стартом проєкту <b style="color:#ffffff">${p}</b>! Ми щиро раді працювати над ним разом із вами — і сьогодні все офіційно починається.`
      : 'Вітаємо зі стартом вашого проєкту! Ми щиро раді працювати над ним разом із вами — і сьогодні все офіційно починається.'),
    ready: 'Ваш особистий кабінет уже готовий. У ньому — все про проєкт, від першого кроку до фінальної передачі:',
    features: [
      ['Онбординг і роадмап', 'що відбувається, в якому порядку і коли'],
      ['Прогрес наживо', 'задачі, таймлайн і дедлайни — завжди актуальні'],
      ['Прямий звʼязок із командою', 'чат, нотатки, запити на правки й рахунки в одному місці'],
    ],
    cta: 'Увійти в кабінет',
    ctaNote: 'Один клік, щоб встановити пароль — це десять секунд.',
    after: (url, email) => `Надалі входьте на <a href="${url}" style="color:#9ca3af">${url.replace(/^https?:\/\//, '')}</a> з адресою <b style="color:#d1d5db">${email}</b> і паролем — або через Google з цією ж адресою.`,
    signoff: 'Зробімо щось круте.',
    team: 'Команда Gudrix',
    ignore: 'Якщо ви не чекали на цей лист, просто проігноруйте його.',
  },
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export function clientInviteEmail(input: ClientInviteInput): { subject: string; html: string; text: string } {
  const c = COPY[input.lang]
  const name = esc(input.firstName.trim())
  const projectPlain = input.projectNames.length === 1 ? input.projectNames[0].trim() : null
  const project = projectPlain ? esc(projectPlain) : null
  const email = esc(input.email)
  const url = input.inviteUrl
  const loginUrl = input.loginUrl

  const features = c.features.map(([title, text]) => `
          <tr>
            <td width="28" valign="top" style="padding:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:22px;color:#2affaa">✦</td>
            <td valign="top" style="padding:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:22px;color:#a1a1aa">
              <b style="color:#ffffff;font-weight:600">${title}</b> — ${text}
            </td>
          </tr>`).join('')

  const html = `<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(c.subject(projectPlain))}</title>
</head>
<body style="margin:0;padding:0;background:#09090b">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${c.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#09090b" style="background:#09090b">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr>
          <td style="padding:0 4px 20px 4px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">
            gudrix<span style="color:#2affaa">.</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="#18181b" style="background:#18181b;border:1px solid #27272a;border-radius:24px;padding:40px 36px 36px 36px">
            <div style="font-size:44px;line-height:1">🚀</div>
            <div style="margin-top:22px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#2affaa">${c.eyebrow}</div>
            <h1 style="margin:10px 0 0 0;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;letter-spacing:-0.8px;color:#ffffff">${c.headline(name)}</h1>
            <p style="margin:22px 0 0 0;font-family:${FONT};font-size:16px;line-height:26px;color:#d4d4d8">${c.intro(project)}</p>
            <p style="margin:16px 0 20px 0;font-family:${FONT};font-size:16px;line-height:26px;color:#d4d4d8">${c.ready}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${features}
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px">
              <tr>
                <td bgcolor="#2affaa" style="background:#2affaa;border-radius:999px">
                  <a href="${url}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#09090b;text-decoration:none">${c.cta} &rarr;</a>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:#a1a1aa">${c.ctaNote}</p>
            <div style="margin:30px 0 0 0;border-top:1px solid #27272a;padding-top:22px;font-family:${FONT};font-size:16px;line-height:24px;color:#ffffff">
              ${c.signoff}<br><span style="color:#a1a1aa">${c.team}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:19px;color:#71717a">
            ${c.after(loginUrl, email)}<br>${c.ignore}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

  const strip = (s: string) => s.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '')
  const text = [
    strip(c.headline(input.firstName.trim())),
    '',
    strip(c.intro(projectPlain)),
    '',
    c.ready,
    ...c.features.map(([t, d]) => `• ${t} — ${d}`),
    '',
    `${c.cta}: ${url}`,
    c.ctaNote,
    '',
    strip(c.after(loginUrl, input.email)),
    '',
    `${c.signoff}`,
    c.team,
  ].join('\n')

  return { subject: c.subject(projectPlain), html, text }
}
