// Shared bits for outgoing email: the sender shown in the recipient's inbox
// and the branded signature under letters written from the app.

const BRAND = 'Gudrix Agency'

// "Gudrix Agency <hello@…>" — a bare address makes inboxes show its local
// part ("hello") as the sender. SMTP_FROM wins when it already has a name.
export function mailFrom(): string | { name: string; address: string } {
  const from = (process.env.SMTP_FROM ?? '').trim()
  if (from.includes('<')) return from
  return { name: process.env.SMTP_FROM_NAME?.trim() || BRAND, address: from || process.env.SMTP_USER! }
}

export function mailFromAddress(): string {
  const from = (process.env.SMTP_FROM ?? '').trim()
  return from.match(/<([^>]+)>/)?.[1] ?? (from || process.env.SMTP_USER!)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A plain-text letter as HTML: the text as written, then the logo signature
export function letterHtml(text: string): string {
  const site = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  const body = esc(text.trim())
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#09090b">$1</a>')
    .replace(/\r?\n/g, '<br>')
  const logo = site
    ? `<img src="${site}/icons/icon-192.png" width="40" height="40" alt="Gudrix" style="display:block;border-radius:10px;border:0">`
    : ''
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
<div>${body}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:16px"><tr>
${logo ? `<td style="padding:16px 12px 0 0;vertical-align:middle">${logo}</td>` : ''}
<td style="padding-top:16px;vertical-align:middle;font-size:13px;line-height:1.45;color:#6b7280">
<span style="font-size:14px;font-weight:600;color:#09090b">${BRAND}</span><br>
UX/UI design &amp; development · <a href="https://gudrix.com" style="color:#6b7280">gudrix.com</a>
</td></tr></table>
</div>`
}
