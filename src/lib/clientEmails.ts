// Emails that keep a client in the loop on the Gudrix Platform: a new message
// from the team, and a task that is ready for their review. Same dark card as
// the welcome letter, a notch calmer. Table layout and inline styles only.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
export type MailLang = 'en' | 'uk'
export interface BuiltMail { subject: string; html: string; text: string }

function shell(o: {
  lang: MailLang
  preheader: string
  eyebrow: string
  headline: string        // already escaped
  body: string            // already escaped HTML
  cta: { label: string; url: string }
  secondary?: { label: string; url: string }
  footer: string
}): string {
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background:#09090b">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#09090b" style="background:#09090b">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr>
          <td style="padding:0 4px 20px 4px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">
            gudrix<span style="color:#2affaa">.</span>
            <span style="font-size:12px;font-weight:500;letter-spacing:0;color:#71717a">&nbsp;&nbsp;Platform</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="#18181b" style="background:#18181b;border:1px solid #27272a;border-radius:24px;padding:34px 34px 32px 34px">
            <div style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:#2affaa">${esc(o.eyebrow)}</div>
            <h1 style="margin:12px 0 0 0;font-family:${FONT};font-size:27px;line-height:34px;font-weight:700;letter-spacing:-0.5px;color:#ffffff">${o.headline}</h1>
            ${o.body}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px">
              <tr>
                <td bgcolor="#2affaa" style="background:#2affaa;border-radius:999px">
                  <a href="${o.cta.url}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:#09090b;text-decoration:none">${esc(o.cta.label)} &rarr;</a>
                </td>
                ${o.secondary ? `<td style="padding-left:18px"><a href="${o.secondary.url}" style="font-family:${FONT};font-size:14px;font-weight:600;color:#d4d4d8;text-decoration:underline">${esc(o.secondary.label)}</a></td>` : ''}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:19px;color:#71717a">${o.footer}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

const p = (html: string, color = '#d4d4d8') =>
  `<p style="margin:16px 0 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:${color}">${html}</p>`

const FOOTER: Record<MailLang, (project: string) => string> = {
  en: project => `You’re getting this because you’re a client on the Gudrix Platform${project ? ` (${esc(project)})` : ''}. Replying to this email reaches our inbox — to keep everything in one thread, answer in the platform.`,
  uk: project => `Ви отримали цей лист, бо ви клієнт на Gudrix Platform${project ? ` (${esc(project)})` : ''}. Відповідь на цей лист прийде на нашу пошту — щоб усе було в одному місці, відповідайте в платформі.`,
}

// ── A new message from the team in the project chat ──────────────────────────

export function clientMessageEmail(o: {
  lang: MailLang
  firstName: string
  senderName: string
  projectName: string
  message: string
  fileNames: string[]
  chatUrl: string
}): BuiltMail {
  const uk = o.lang === 'uk'
  const sender = o.senderName.trim() || (uk ? 'Команда Gudrix' : 'The Gudrix team')
  const text = o.message.trim()
  const shown = text.length > 900 ? text.slice(0, 900).trimEnd() + '…' : text
  const files = o.fileNames.filter(Boolean)

  const quote = shown
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>
        <td width="3" bgcolor="#2affaa" style="background:#2affaa;border-radius:3px"></td>
        <td style="padding:2px 0 2px 16px;font-family:${FONT};font-size:16px;line-height:26px;color:#ffffff">${esc(shown).replace(/\r?\n/g, '<br>')}</td>
      </tr></table>`
    : ''
  const attach = files.length
    ? p(`📎 ${files.map(esc).join(', ')}`, '#a1a1aa')
    : ''

  const subject = uk ? `Нове повідомлення від команди — ${o.projectName}` : `New message from the team — ${o.projectName}`
  const headline = uk ? `${esc(sender)} пише вам` : `${esc(sender)} sent you a message`
  const lead = uk
    ? `${o.firstName ? `${esc(o.firstName)}, у` : 'У'} проєкті <b style="color:#ffffff">${esc(o.projectName)}</b> є новина для вас:`
    : `${o.firstName ? `${esc(o.firstName)}, there’s` : 'There’s'} news for you on <b style="color:#ffffff">${esc(o.projectName)}</b>:`
  const cta = uk ? 'Відповісти в платформі' : 'Reply in the platform'

  const html = shell({
    lang: o.lang,
    preheader: shown || (uk ? 'Команда надіслала вам файл' : 'The team sent you a file'),
    eyebrow: uk ? 'Нове повідомлення' : 'New message',
    headline,
    body: p(lead) + quote + attach,
    cta: { label: cta, url: o.chatUrl },
    footer: FOOTER[o.lang](o.projectName),
  })
  const plain = [
    uk ? `${sender} пише вам у проєкті «${o.projectName}»:` : `${sender} sent you a message on ${o.projectName}:`,
    '', shown, ...(files.length ? ['', `📎 ${files.join(', ')}`] : []), '',
    `${cta}: ${o.chatUrl}`,
  ].join('\n')
  return { subject, html, text: plain }
}

// ── A task has moved to review and waits for the client ──────────────────────

export function clientReviewEmail(o: {
  lang: MailLang
  firstName: string
  projectName: string
  taskTitle: string
  taskDescription: string
  madeBy: string[]
  taskUrl: string
  chatUrl: string
}): BuiltMail {
  const uk = o.lang === 'uk'
  const desc = o.taskDescription.trim()
  const shown = desc.length > 320 ? desc.slice(0, 320).trimEnd() + '…' : desc
  const by = o.madeBy.filter(Boolean)

  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>
      <td bgcolor="#09090b" style="background:#09090b;border:1px solid #27272a;border-radius:16px;padding:18px 20px">
        <div style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:600;color:#ffffff">${esc(o.taskTitle)}</div>
        ${shown ? `<div style="margin-top:6px;font-family:${FONT};font-size:14px;line-height:21px;color:#a1a1aa">${esc(shown).replace(/\r?\n/g, '<br>')}</div>` : ''}
        ${by.length ? `<div style="margin-top:10px;font-family:${FONT};font-size:12px;line-height:18px;color:#71717a">${uk ? 'Працювали' : 'Made by'}: <span style="color:#d4d4d8">${by.map(esc).join(', ')}</span></div>` : ''}
      </td>
    </tr></table>`

  const subject = uk ? `Готово до вашого перегляду: ${o.taskTitle}` : `Ready for your review: ${o.taskTitle}`
  const headline = uk ? 'Є що показати ✨<br>Чекаємо на ваш погляд' : 'Something to show you ✨<br>Ready for your review'
  const lead = uk
    ? `${o.firstName ? `${esc(o.firstName)}, ми` : 'Ми'} закінчили частину роботи в проєкті <b style="color:#ffffff">${esc(o.projectName)}</b> — тепер слово за вами.`
    : `${o.firstName ? `${esc(o.firstName)}, we’ve` : 'We’ve'} finished a piece of <b style="color:#ffffff">${esc(o.projectName)}</b> — now it’s over to you.`
  const hint = uk
    ? 'Подивіться, і якщо щось варто змінити — залиште запит на правки прямо на задачі.'
    : 'Take a look, and if anything needs changing, request it right on the task.'
  const cta = uk ? 'Переглянути задачу' : 'Review the task'
  const second = uk ? 'Написати команді' : 'Message the team'

  const html = shell({
    lang: o.lang,
    preheader: uk ? `«${o.taskTitle}» чекає на ваш перегляд` : `“${o.taskTitle}” is waiting for your review`,
    eyebrow: uk ? 'Готово до перегляду' : 'Ready for review',
    headline,
    body: p(lead) + card + p(hint, '#a1a1aa'),
    cta: { label: cta, url: o.taskUrl },
    secondary: { label: second, url: o.chatUrl },
    footer: FOOTER[o.lang](o.projectName),
  })
  const plain = [
    uk ? `Готово до вашого перегляду — проєкт «${o.projectName}»` : `Ready for your review — ${o.projectName}`,
    '', o.taskTitle, ...(shown ? [shown] : []), ...(by.length ? [`${uk ? 'Працювали' : 'Made by'}: ${by.join(', ')}`] : []), '',
    hint, '', `${cta}: ${o.taskUrl}`, `${second}: ${o.chatUrl}`,
  ].join('\n')
  return { subject, html, text: plain }
}

// ── An estimate for a task the client asked for ──────────────────────────────

export function clientEstimateEmail(o: {
  lang: MailLang
  firstName: string
  projectName: string
  taskTitle: string
  hours: number | null
  rate?: string | null       // hourly rate, already formatted with currency
  cost: string | null        // total, already formatted with currency
  note: string
  revised: boolean
  taskUrl: string
  chatUrl: string
}): BuiltMail {
  const uk = o.lang === 'uk'
  const note = o.note.trim()
  const hoursText = o.hours ? (uk ? `${o.hours} год` : `${o.hours} h`) : null
  const cell = (label: string, value: string) =>
    `<td valign="top" style="padding:0 28px 0 0"><div style="font-family:${FONT};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#71717a">${label}</div><div style="margin-top:4px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:#ffffff">${esc(value)}</div></td>`
  const figures = [
    hoursText ? cell(uk ? 'Час' : 'Time', hoursText) : '',
    o.rate ? cell(uk ? 'Рейт' : 'Rate', `${o.rate}${uk ? '/год' : '/h'}`) : '',
    o.cost ? cell(uk ? 'Разом' : 'Total', o.cost) : '',
  ].join('')

  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>
      <td bgcolor="#09090b" style="background:#09090b;border:1px solid #27272a;border-radius:16px;padding:18px 20px">
        <div style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:600;color:#ffffff">${esc(o.taskTitle)}</div>
        ${figures ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>${figures}</tr></table>` : ''}
        ${note ? `<div style="margin-top:14px;font-family:${FONT};font-size:14px;line-height:21px;color:#a1a1aa">${esc(note).replace(/\r?\n/g, '<br>')}</div>` : ''}
      </td>
    </tr></table>`

  const subject = uk
    ? `${o.revised ? 'Оновлена оцінка' : 'Оцінка готова'}: ${o.taskTitle}`
    : `${o.revised ? 'Updated estimate' : 'Your estimate is ready'}: ${o.taskTitle}`
  const headline = uk
    ? (o.revised ? 'Ми оновили оцінку' : 'Оцінка готова ✨')
    : (o.revised ? 'We’ve updated the estimate' : 'Your estimate is ready ✨')
  const lead = uk
    ? `${o.firstName ? `${esc(o.firstName)}, ми` : 'Ми'} оцінили задачу, яку ви додали в проєкт <b style="color:#ffffff">${esc(o.projectName)}</b>.`
    : `${o.firstName ? `${esc(o.firstName)}, we’ve` : 'We’ve'} estimated the task you added to <b style="color:#ffffff">${esc(o.projectName)}</b>.`
  const hint = (uk
    ? 'Погодьте — і задача одразу піде в роботу. Якщо щось не так, залиште коментар, і ми переглянемо оцінку.'
    : 'Approve it and the task goes straight into work. If something looks off, leave a comment and we’ll revise it.')
    + (o.cost ? (uk ? ` Погодження додасть ${o.cost} до бюджету проєкту.` : ` Approving adds ${o.cost} to the project budget.`) : '')
  const cta = uk ? 'Переглянути оцінку' : 'Review the estimate'
  const second = uk ? 'Написати команді' : 'Message the team'

  const html = shell({
    lang: o.lang,
    preheader: [hoursText, o.cost].filter(Boolean).join(' · ') || o.taskTitle,
    eyebrow: uk ? 'Оцінка задачі' : 'Task estimate',
    headline,
    body: p(lead) + card + p(hint, '#a1a1aa'),
    cta: { label: cta, url: o.taskUrl },
    secondary: { label: second, url: o.chatUrl },
    footer: FOOTER[o.lang](o.projectName),
  })
  const plain = [
    `${headline.replace(' ✨', '')} — ${o.projectName}`, '', o.taskTitle,
    ...([hoursText, o.cost].filter(Boolean).length ? [[hoursText, o.cost].filter(Boolean).join(' · ')] : []),
    ...(note ? [note] : []), '', hint, '', `${cta}: ${o.taskUrl}`,
  ].join('\n')
  return { subject, html, text: plain }
}

// ── A notice for the agency itself (Ukrainian, same look) ────────────────────

export function agencyNoticeEmail(o: {
  subject: string
  eyebrow: string
  headline: string
  lines: string[]
  quote?: string
  cta: { label: string; url: string }
}): BuiltMail {
  const quote = o.quote?.trim()
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>
        <td width="3" bgcolor="#2affaa" style="background:#2affaa;border-radius:3px"></td>
        <td style="padding:2px 0 2px 16px;font-family:${FONT};font-size:16px;line-height:26px;color:#ffffff">${esc(o.quote.trim()).replace(/\r?\n/g, '<br>')}</td>
      </tr></table>`
    : ''
  const html = shell({
    lang: 'uk',
    preheader: o.lines[0] ?? o.headline,
    eyebrow: o.eyebrow,
    headline: esc(o.headline),
    body: o.lines.map(l => p(esc(l))).join('') + quote,
    cta: o.cta,
    footer: 'Службове сповіщення Gudrix Platform для команди.',
  })
  const text = [o.headline, '', ...o.lines, ...(o.quote?.trim() ? ['', `«${o.quote.trim()}»`] : []), '', `${o.cta.label}: ${o.cta.url}`].join('\n')
  return { subject: o.subject, html, text }
}

// ── A document sent to the client for review ─────────────────────────────────
// A light letter: white card on a pale background with a mint brand plaque on
// top. The letter text is the admin's own (editable before sending); the file
// travels as a real attachment, so the client can open it without signing in.

export interface MailFile { name: string; url: string; size: number | null; attached: boolean }

export const fileSize = (bytes: number | null) => {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
const fileKind = (name: string) => {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  return ext.length > 0 && ext.length <= 5 ? ext : 'FILE'
}

// The letter the admin sees prefilled, and may rewrite, before sending
export function documentLetterDefault(o: {
  lang: MailLang
  firstName: string
  projectName: string
  senderName: string
  attached: boolean
  hasFiles: boolean
}): string {
  const sender = o.senderName.trim() || 'Gudrix'
  if (o.lang === 'uk') {
    return [
      o.firstName ? `Вітаю, ${o.firstName}!` : 'Вітаю!',
      '',
      `Ми завершили наступну частину роботи над проєктом «${o.projectName}» і хочемо показати її вам. ${!o.hasFiles
        ? 'Усе, що потрібно для перегляду, — нижче в цьому листі.'
        : o.attached
          ? 'Документ прикріплений до цього листа — його можна відкрити одразу, без входу в платформу.'
          : 'Документ можна завантажити за кнопкою нижче — без входу в платформу.'}`,
      '',
      'Перегляньте, будь ласка, коли буде зручно, і напишіть, що думаєте: можна відповісти на цей лист або написати нам у платформі.',
      '',
      'Дякую!',
      `${sender} · Gudrix`,
    ].join('\n')
  }
  return [
    o.firstName ? `Hello ${o.firstName},` : 'Hello,',
    '',
    `We’ve wrapped up the next piece of work on ${o.projectName} and would love your eyes on it. ${!o.hasFiles
      ? 'Everything you need for the review is right below.'
      : o.attached
        ? 'The document is attached to this email, so you can open it right away — no sign-in needed.'
        : 'You can download the document with the button below — no sign-in needed.'}`,
    '',
    'Take a look whenever you have a moment and tell us what you think: reply to this email or message us in the platform, both work.',
    '',
    'Thank you,',
    `${sender} · Gudrix`,
  ].join('\n')
}

const linkify = (escaped: string, color: string) =>
  escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${color};text-decoration:underline">$1</a>`)

export function clientDocumentEmail(o: {
  lang: MailLang
  projectName: string
  title: string            // the note's own text: what the document is
  letter: string           // the letter text, as written by the admin
  files: MailFile[]
  platformUrl: string
}): BuiltMail {
  const uk = o.lang === 'uk'
  const title = o.title.trim()
  const shownTitle = title.length > 240 ? title.slice(0, 240).trimEnd() + '…' : title
  const letter = o.letter.trim()
  const first = o.files[0]
  const subjectWhat = (shownTitle.split(/\r?\n/)[0] || first?.name || (uk ? 'документ' : 'a document')).slice(0, 90)
  const subject = uk ? `На рев’ю: ${subjectWhat} — ${o.projectName}` : `For your review: ${subjectWhat} — ${o.projectName}`

  const paragraphs = letter.split(/\r?\n\s*\r?\n/).map(par =>
    `<p style="margin:14px 0 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:#3f3f46">${linkify(esc(par), '#09090b').replace(/\r?\n/g, '<br>')}</p>`).join('')

  const fileRows = o.files.map(f => {
    const meta = [fileKind(f.name), fileSize(f.size), f.attached ? (uk ? 'у вкладенні до листа' : 'attached to this email') : ''].filter(Boolean).join(' · ')
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>
      <td bgcolor="#fafafa" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:14px;padding:14px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="44" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" bgcolor="#d9fff0" style="background:#d9fff0;border-radius:10px;font-family:${FONT};font-size:10px;font-weight:800;letter-spacing:0.4px;color:#047857">${esc(fileKind(f.name))}</td></tr></table>
          </td>
          <td valign="middle" style="padding-left:12px">
            <div style="font-family:${FONT};font-size:15px;line-height:21px;font-weight:600;color:#09090b;word-break:break-word">${esc(f.name)}</div>
            <div style="font-family:${FONT};font-size:12px;line-height:18px;color:#71717a">${esc(meta)}</div>
          </td>
          <td align="right" valign="middle" style="padding-left:12px;white-space:nowrap">
            <a href="${esc(f.url)}" style="font-family:${FONT};font-size:13px;font-weight:600;color:#09090b;text-decoration:underline">${uk ? 'Завантажити' : 'Download'}</a>
          </td>
        </tr></table>
      </td>
    </tr></table>`
  }).join('')

  const docBlock = (shownTitle || o.files.length)
    ? `<div style="margin-top:26px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#71717a">${uk ? 'Документ на рев’ю' : 'For your review'}</div>
       ${shownTitle ? `<div style="margin-top:6px;font-family:${FONT};font-size:18px;line-height:26px;font-weight:700;letter-spacing:-0.2px;color:#09090b">${linkify(esc(shownTitle), '#09090b').replace(/\r?\n/g, '<br>')}</div>` : ''}
       ${fileRows}`
    : ''

  const cta = uk ? 'Відкрити в Gudrix Platform' : 'Open in Gudrix Platform'
  const html = `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#f4f4f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(uk ? `Команда Gudrix надіслала вам документ на рев’ю — ${o.projectName}` : `The Gudrix team sent you a document to review — ${o.projectName}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background:#f4f4f5">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:24px">
        <tr>
          <td bgcolor="#e6fff4" style="background:#e6fff4;border-bottom:1px solid #c8f5e1;border-radius:24px 24px 0 0;padding:18px 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#09090b">gudrix<span style="color:#00b877">.</span></td>
              <td align="right" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#047857">Platform</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px 32px">
            <div style="font-family:${FONT};font-size:13px;line-height:20px;color:#71717a">${esc(o.projectName)}</div>
            ${paragraphs}
            ${docBlock}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px">
              <tr>
                <td bgcolor="#2affaa" style="background:#2affaa;border-radius:999px">
                  <a href="${esc(o.platformUrl)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#09090b;text-decoration:none">${esc(cta)} &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr>
          <td style="padding:18px 12px 0 12px;font-family:${FONT};font-size:12px;line-height:19px;color:#71717a">${uk
            ? `Ви отримали цей лист, бо ви клієнт на Gudrix Platform (${esc(o.projectName)}). На нього можна просто відповісти — лист прийде нашій команді.`
            : `You’re getting this because you’re a client on the Gudrix Platform (${esc(o.projectName)}). You can simply reply to this email — it reaches our team.`}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

  const text = [
    letter,
    ...(shownTitle || o.files.length ? ['', uk ? 'Документ на рев’ю:' : 'For your review:'] : []),
    ...(shownTitle ? [shownTitle] : []),
    ...o.files.map(f => `- ${f.name}${fileSize(f.size) ? ` (${fileSize(f.size)})` : ''}: ${f.url}`),
    '',
    `${cta}: ${o.platformUrl}`,
  ].join('\n')
  return { subject, html, text }
}
