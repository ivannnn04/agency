import supabaseAdmin from '@/lib/supabaseAdmin'
import { clientDocumentEmail, documentLetterDefault, BuiltMail, MailFile } from '@/lib/clientEmails'
import {
  appOrigin, deliver, firstName, projectRecipients, quietNextChatMail, MailAttachment, Recipient,
} from '@/lib/clientNotify'

// "Send to the client for review": a project note (usually a document) goes
// to the project's clients as a branded letter with the file attached, plus a
// line in the client chat so it also shows up inside the platform.

// Mail servers reject big letters (Gmail: 25 MB, and attachments grow by a
// third in transit). Above this the letter carries download links instead.
const MAX_ATTACH_BYTES = 18 * 1024 * 1024

const storagePrefix = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1/object/public/`
// Only files from our own storage are ever fetched or linked
const ours = (url: unknown): url is string =>
  typeof url === 'string' && !!process.env.NEXT_PUBLIC_SUPABASE_URL && url.startsWith(storagePrefix())

export const reviewKey = (noteId: string) => `note_review:${noteId}`

interface NoteRow { id: string; project_id: string; author_type: string; content: string | null; files: { url: string; name: string }[] | null }

export interface Prepared {
  projectId: string
  projectName: string
  title: string
  sender: string
  to: Recipient[]
  files: MailFile[]
  defaultLetter: string
  build: (r: Recipient) => BuiltMail
}

async function sizeOf(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    const n = Number(r.headers.get('content-length'))
    return r.ok && Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export async function prepareReview(noteId: string, message: string | undefined, origin?: string): Promise<Prepared | { error: string; status: number }> {
  const { data: note } = await supabaseAdmin.from('project_notes').select('*').eq('id', noteId).maybeSingle()
  const n = note as NoteRow | null
  if (!n) return { error: 'Нотатку не знайдено', status: 404 }
  if (n.author_type === 'client') return { error: 'Це нотатка клієнта — її не надсилаємо йому на рев’ю', status: 400 }

  const [{ data: project }, to, { data: profile }] = await Promise.all([
    supabaseAdmin.from('projects').select('name').eq('id', n.project_id).maybeSingle(),
    projectRecipients(n.project_id),
    supabaseAdmin.from('admin_profile').select('name').eq('id', 'main').maybeSingle(),
  ])
  if (!project) return { error: 'Проєкт не знайдено', status: 404 }

  const sender = String((profile as { name?: string } | null)?.name ?? '').trim() || 'Ivan'
  const raw = (n.files ?? []).filter(f => ours(f?.url) && f?.name)
  const sized = await Promise.all(raw.map(async f => ({ name: f.name, url: f.url, size: await sizeOf(f.url) })))
  const total = sized.reduce((s, f) => s + (f.size ?? 0), 0)
  const fits = total <= MAX_ATTACH_BYTES
  const files: MailFile[] = sized.map(f => ({ ...f, attached: fits }))

  const title = (n.content ?? '').trim()
  const letterFor = (r: Recipient | null, personal: boolean) => documentLetterDefault({
    lang: r?.lang ?? 'en',
    firstName: personal && r ? firstName(r.name) : '',
    projectName: project.name,
    senderName: sender,
    attached: fits,
    hasFiles: files.length > 0,
  })
  // One recipient is greeted by name; several get a neutral greeting
  const defaultLetter = letterFor(to[0] ?? null, to.length === 1)
  const custom = (message ?? '').trim()
  const edited = !!custom && custom !== defaultLetter.trim()

  const platformUrl = `${appOrigin(origin)}/portal/project/${n.project_id}?notes=1`
  return {
    projectId: n.project_id,
    projectName: project.name,
    title,
    sender,
    to,
    files,
    defaultLetter,
    // An untouched letter is written for each recipient in their own language
    build: r => clientDocumentEmail({
      lang: r.lang,
      projectName: project.name,
      title,
      letter: edited ? custom : letterFor(r, true),
      files,
      platformUrl,
    }),
  }
}

export async function sendReview(noteId: string, message: string | undefined, origin?: string) {
  const p = await prepareReview(noteId, message, origin)
  if ('error' in p) return p
  if (p.to.length === 0) return { error: 'У проєкті немає клієнтів з емейлом — додай їх у розділі «Клієнти»', status: 400 }

  // Fetch the files to attach them; anything that fails falls back to its link
  const attachments: MailAttachment[] = []
  if (p.files.some(f => f.attached)) {
    let total = 0
    for (const f of p.files) {
      try {
        const r = await fetch(f.url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const content = Buffer.from(await r.arrayBuffer())
        total += content.length
        if (total > MAX_ATTACH_BYTES) throw new Error('too big')
        attachments.push({ filename: f.name, content, contentType: r.headers.get('content-type') ?? undefined })
        f.size = content.length
      } catch {
        f.attached = false
      }
    }
  }

  const result = await deliver(p.to, p.build, attachments)
  if (result.sent === 0) return { error: result.error ?? 'Лист не надіслано', status: 502 }

  // Inside the platform: a line in the client chat, with the document
  const uk = p.to[0].lang === 'uk'
  const what = p.title.split(/\r?\n/)[0].slice(0, 200)
  const content = `📄 ${uk ? 'Документ на рев’ю' : 'A document for your review'}${what ? `: ${what}` : ''}`
  await quietNextChatMail(p.projectId, content)
  const { error: chatErr } = await supabaseAdmin.from('project_messages').insert({
    project_id: p.projectId,
    channel: 'client',
    sender_type: 'admin',
    sender_name: p.sender,
    content,
    file_url: p.files[0]?.url ?? null,
    file_name: p.files[0]?.name ?? null,
  })

  const at = new Date().toISOString()
  await supabaseAdmin.from('integration_state').upsert({
    key: reviewKey(noteId),
    value: { project_id: p.projectId, at, to: p.to.map(r => r.email) },
    updated_at: at,
  })

  return {
    sent: result.sent,
    failed: p.to.length - result.sent,
    error: result.error ?? null,
    attached: attachments.length,
    chat: !chatErr,
    at,
    to: p.to.map(r => r.email),
  }
}
