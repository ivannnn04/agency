import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { imapConfig, stripQuoted } from '@/lib/mailSync'

// Pull the correspondence with a project's clients out of the mailbox the
// app sends from, into project_emails: their replies (inbox) and everything
// written to them (Sent — by hand or by the platform). A project's page then
// shows the whole history next to its calls.

const STATE_KEY = 'project_mail'
const FIRST_SYNC_DAYS = 180
const OVERLAP_MS = 86_400_000
const MAX_PER_ADDRESS = 60
// Letters the platform sends by itself carry this header (see clientNotify)
export const AUTO_HEADER = 'X-Gudrix-Auto'

export interface ProjectMailState {
  last_synced_at?: string
  last_error?: string | null
  running_since?: string | null
  // Addresses already read back to the start: a client added later gets the
  // full history on the first run that sees them
  known?: string[]
}
export interface ProjectMailResult { imported: number; projects: number; skipped?: 'running' | 'no clients' }

export async function getProjectMailState(): Promise<ProjectMailState> {
  const { data } = await supabaseAdmin.from('integration_state').select('value').eq('key', STATE_KEY).maybeSingle()
  return (data?.value ?? {}) as ProjectMailState
}

async function patchState(patch: Partial<ProjectMailState>) {
  const cur = await getProjectMailState()
  await supabaseAdmin
    .from('integration_state')
    .upsert({ key: STATE_KEY, value: { ...cur, ...patch }, updated_at: new Date().toISOString() })
}

export const MAIL_MIGRATION_HINT = 'Запусти міграцію supabase/project_comms_migration.sql у Supabase SQL Editor'

export async function syncProjectMail(): Promise<ProjectMailResult> {
  const cfg = imapConfig()
  if (!cfg) throw new Error('Пошта не налаштована (SMTP_HOST / SMTP_USER / SMTP_PASS)')

  const state = await getProjectMailState()
  if (state.running_since && Date.now() - new Date(state.running_since).getTime() < 240_000) {
    return { imported: 0, projects: 0, skipped: 'running' }
  }

  // Which address belongs to which projects (a client can be on several)
  const { data: links } = await supabaseAdmin.from('project_clients').select('project_id, clients(email)')
  const own = cfg.user.toLowerCase()
  const byAddress = new Map<string, string[]>()
  for (const l of (links ?? []) as unknown as { project_id: string; clients: { email: string | null } | null }[]) {
    const e = (l.clients?.email ?? '').trim().toLowerCase()
    if (!e || e === own) continue
    byAddress.set(e, [...new Set([...(byAddress.get(e) ?? []), l.project_id])])
  }
  if (byAddress.size === 0) return { imported: 0, projects: 0, skipped: 'no clients' }

  const startedAt = new Date()
  await patchState({ running_since: startedAt.toISOString() })

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })

  try {
    const { data: known, error: knownErr } = await supabaseAdmin.from('project_emails').select('project_id, message_id')
    if (knownErr) throw new Error(knownErr.message)
    const have = new Set((known ?? []).map(k => `${k.project_id}|${k.message_id}`))

    const full = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000)
    const recent = state.last_synced_at ? new Date(new Date(state.last_synced_at).getTime() - OVERLAP_MS) : full
    const seen = new Set(state.known ?? [])

    const result: ProjectMailResult = { imported: 0, projects: 0 }
    const touched = new Set<string>()

    await client.connect()
    const boxes = await client.list()
    const sent = boxes.find(b => b.specialUse === '\\Sent')?.path
    const folders: { path: string; direction: 'in' | 'out' }[] = [{ path: 'INBOX', direction: 'in' }]
    if (sent) folders.push({ path: sent, direction: 'out' })

    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder.path)
      try {
        for (const [address, projectIds] of byAddress) {
          const since = seen.has(address) ? recent : full
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
            const missing = projectIds.filter(p => !have.has(`${p}|${messageId}`))
            if (missing.length === 0) continue
            const automated = folder.direction === 'out' && !!mail.headers.get(AUTO_HEADER.toLowerCase())
            const row = {
              direction: folder.direction,
              subject: (mail.subject ?? '').slice(0, 300),
              body: stripQuoted(mail.text ?? '').slice(0, 20_000),
              from_email: folder.direction === 'in' ? address : own,
              to_email: folder.direction === 'in' ? own : address,
              sent_at: (mail.date ?? new Date()).toISOString(),
              message_id: messageId,
              automated,
            }
            for (const projectId of missing) {
              const { error } = await supabaseAdmin.from('project_emails').insert({ ...row, project_id: projectId })
              if (error) {
                if (/duplicate|unique/i.test(error.message)) continue
                throw new Error(error.message)
              }
              have.add(`${projectId}|${messageId}`)
              result.imported++
              touched.add(projectId)
            }
          }
        }
      } finally {
        lock.release()
      }
    }
    await client.logout().catch(() => {})

    await patchState({
      last_synced_at: startedAt.toISOString(),
      last_error: null,
      running_since: null,
      known: [...byAddress.keys()],
    })
    result.projects = touched.size
    return result
  } catch (e) {
    client.close()
    const raw = (e as Error).message
    const msg = /auth|credential|login/i.test(raw)
      ? `Пошта відхилила вхід по IMAP (${raw.slice(0, 120)}). Перевір, що IMAP увімкнений і пароль — це пароль застосунку.`
      : /project_emails|schema cache/i.test(raw)
        ? MAIL_MIGRATION_HINT
        : `Пошта: ${raw.slice(0, 200)}`
    await patchState({ last_error: msg, running_since: null }).catch(() => {})
    throw new Error(msg)
  }
}
