import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { generateLeadOverview } from '@/lib/leadInsight'

// Pull the correspondence with leads out of the mailbox the app sends from:
// replies in the inbox and letters written outside the app (Sent folder) are
// stored on the lead, so the card and the AI see the whole thread.

const STATE_KEY = 'mail'
const FIRST_SYNC_DAYS = 90
const OVERLAP_MS = 86_400_000
const MAX_PER_ADDRESS = 30
const MAX_ANALYSES_PER_RUN = 6

export interface MailState {
  last_synced_at?: string
  last_error?: string | null
  running_since?: string | null
}
export interface MailSyncResult { imported: number; leads: number; analyzed: number; skipped?: 'running' }

export function imapConfig() {
  const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  const host = (IMAP_HOST || (SMTP_HOST ?? '').replace(/^smtp\./i, 'imap.')).trim()
  const user = (IMAP_USER || SMTP_USER || '').trim()
  const pass = IMAP_PASS || SMTP_PASS || ''
  if (!host || !user || !pass) return null
  return { host, port: Number(IMAP_PORT ?? 993), user, pass }
}

export async function getMailState(): Promise<MailState> {
  const { data } = await supabaseAdmin.from('integration_state').select('value').eq('key', STATE_KEY).maybeSingle()
  return (data?.value ?? {}) as MailState
}

async function patchMailState(patch: Partial<MailState>) {
  const cur = await getMailState()
  const { error } = await supabaseAdmin
    .from('integration_state')
    .upsert({ key: STATE_KEY, value: { ...cur, ...patch }, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

const emailsOf = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []

// Keep what the person wrote; drop the quoted history under it
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^On .{5,200}wrote:$/i.test(t) || /^-{2,}\s*(Original|Forwarded) message/i.test(t) || /^(From|Від):\s.+@/i.test(t)) break
    if (/^\d{1,2}\s.{3,40}\d{4}.{0,40}(пише|написав|wrote)/i.test(t) || /^(пн|вт|ср|чт|пт|сб|нд),.{5,80}(пише|wrote):?$/i.test(t)) break
    if (t.startsWith('>')) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function syncMail(): Promise<MailSyncResult> {
  const cfg = imapConfig()
  if (!cfg) throw new Error('Пошта не налаштована (SMTP_HOST / SMTP_USER / SMTP_PASS)')

  const state = await getMailState()
  if (state.running_since && Date.now() - new Date(state.running_since).getTime() < 240_000) {
    return { imported: 0, leads: 0, analyzed: 0, skipped: 'running' }
  }
  const startedAt = new Date()
  await patchMailState({ running_since: startedAt.toISOString() })

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })

  try {
    const since = new Date(
      state.last_synced_at
        ? new Date(state.last_synced_at).getTime() - OVERLAP_MS
        : Date.now() - FIRST_SYNC_DAYS * 86_400_000,
    )

    const { data: leadRows } = await supabaseAdmin.from('crm_leads').select('id, email')
    const own = cfg.user.toLowerCase()
    const byAddress = new Map<string, string>()
    for (const l of leadRows ?? []) for (const e of emailsOf(l.email)) if (e !== own && !byAddress.has(e)) byAddress.set(e, l.id)

    const result: MailSyncResult = { imported: 0, leads: 0, analyzed: 0 }
    const touched = new Set<string>()

    if (byAddress.size > 0) {
      const { data: known, error: knownErr } = await supabaseAdmin
        .from('lead_emails')
        .select('lead_id, direction, subject, sent_at, message_id')
      if (knownErr) throw new Error(knownErr.message)
      const knownIds = new Set((known ?? []).map(k => k.message_id).filter(Boolean) as string[])
      // Letters sent from the app before message ids were stored
      const legacy = (known ?? []).filter(k => !k.message_id && k.direction === 'out')

      await client.connect()
      const boxes = await client.list()
      const sent = boxes.find(b => b.specialUse === '\\Sent')?.path
      const folders: { path: string; direction: 'in' | 'out' }[] = [{ path: 'INBOX', direction: 'in' }]
      if (sent) folders.push({ path: sent, direction: 'out' })

      for (const folder of folders) {
        const lock = await client.getMailboxLock(folder.path)
        try {
          for (const [address, leadId] of byAddress) {
            const found = await client.search(
              folder.direction === 'in' ? { since, from: address } : { since, to: address },
              { uid: true },
            )
            const uids = (Array.isArray(found) ? found : []).slice(-MAX_PER_ADDRESS)
            for (const uid of uids) {
              const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
              if (!msg || !msg.source) continue
              const mail = await simpleParser(msg.source)
              const messageId = (mail.messageId ?? `${folder.path}:${uid}`).slice(0, 300)
              if (knownIds.has(messageId)) continue
              const sentAt = (mail.date ?? new Date()).toISOString()
              const subject = (mail.subject ?? '').slice(0, 300)
              if (folder.direction === 'out') {
                const dup = legacy.find(k =>
                  k.lead_id === leadId && (k.subject ?? '') === subject &&
                  Math.abs(new Date(k.sent_at).getTime() - new Date(sentAt).getTime()) < 10 * 60_000)
                if (dup) continue
              }
              const body = stripQuoted(mail.text ?? '').slice(0, 20_000)
              const { error } = await supabaseAdmin.from('lead_emails').insert({
                lead_id: leadId,
                direction: folder.direction,
                subject,
                body,
                to_email: folder.direction === 'in' ? own : address,
                from_email: folder.direction === 'in' ? address : own,
                sent_at: sentAt,
                message_id: messageId,
              })
              if (error) {
                if (/duplicate|unique/i.test(error.message)) continue
                throw new Error(error.message)
              }
              knownIds.add(messageId)
              result.imported++
              touched.add(leadId)
            }
          }
        } finally {
          lock.release()
        }
      }
      await client.logout().catch(() => {})
    }

    await patchMailState({ last_synced_at: startedAt.toISOString(), last_error: null, running_since: null })

    result.leads = touched.size
    const done = await Promise.allSettled([...touched].slice(0, MAX_ANALYSES_PER_RUN).map(id => generateLeadOverview(id)))
    result.analyzed = done.filter(d => d.status === 'fulfilled').length
    return result
  } catch (e) {
    client.close()
    const raw = (e as Error).message
    const msg = /auth|credential|login/i.test(raw)
      ? `Пошта відхилила вхід по IMAP (${raw.slice(0, 120)}). Перевір, що IMAP увімкнений і пароль — це пароль застосунку.`
      : /lead_emails|message_id|schema cache/i.test(raw)
        ? 'Запусти міграцію supabase/lead_mail_migration.sql у Supabase SQL Editor'
        : `Пошта: ${raw.slice(0, 200)}`
    await patchMailState({ last_error: msg, running_since: null }).catch(() => {})
    throw new Error(msg)
  }
}
