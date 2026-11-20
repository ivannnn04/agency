import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'

// The client list: who may sign in to the client workspace. An email that is
// not here is turned away at /api/portal/me, whatever it signed in with.
// Admin-only.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmails(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : ''
  return [...new Set(text.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))]
}

async function setProjects(clientId: string, projectIds: string[]) {
  const { data: existing } = await supabaseAdmin.from('project_clients').select('project_id').eq('client_id', clientId)
  const have = new Set((existing ?? []).map(r => r.project_id as string))
  const want = new Set(projectIds)
  const add = [...want].filter(p => !have.has(p))
  const drop = [...have].filter(p => !want.has(p))
  if (add.length) await supabaseAdmin.from('project_clients').insert(add.map(project_id => ({ project_id, client_id: clientId })))
  if (drop.length) await supabaseAdmin.from('project_clients').delete().eq('client_id', clientId).in('project_id', drop)
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: clients, error }, { data: links }, { data: projects }, users] = await Promise.all([
    supabaseAdmin.from('clients').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('project_clients').select('client_id, project_id'),
    supabaseAdmin.from('projects').select('id, name, color, status').order('name'),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => null),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Last sign-in comes from the auth account with the same email
  const lastSignIn = new Map<string, string | null>()
  for (const u of users?.data?.users ?? []) {
    if (u.email) lastSignIn.set(u.email.toLowerCase(), u.last_sign_in_at ?? null)
  }

  return NextResponse.json({
    clients: (clients ?? []).map(c => ({
      id: c.id,
      email: c.email,
      name: c.name ?? null,
      lang: c.lang === 'uk' ? 'uk' : 'en',
      invited_at: c.invited_at ?? null,
      created_at: c.created_at ?? null,
      last_sign_in_at: lastSignIn.get(String(c.email).toLowerCase()) ?? null,
      project_ids: (links ?? []).filter(l => l.client_id === c.id).map(l => l.project_id),
    })),
    projects: projects ?? [],
  })
}

// Add one or several clients by email (comma, space or line separated)
export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const emails = parseEmails(body?.emails)
  if (emails.length === 0) return NextResponse.json({ error: 'Вкажи хоча б один коректний email' }, { status: 400 })
  const name = typeof body?.name === 'string' && body.name.trim() && emails.length === 1 ? body.name.trim() : null
  const projectIds: string[] = Array.isArray(body?.projectIds) ? body.projectIds.filter((p: unknown) => typeof p === 'string') : []

  const { data: existing } = await supabaseAdmin.from('clients').select('id, email').in('email', emails)
  const known = new Map((existing ?? []).map(c => [String(c.email).toLowerCase(), c.id as string]))
  const fresh = emails.filter(e => !known.has(e))
  const createdIds: string[] = []
  if (fresh.length) {
    const { data: created, error } = await supabaseAdmin
      .from('clients')
      .insert(fresh.map(email => ({ email, name })))
      .select('id, email')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    for (const c of created ?? []) { known.set(String(c.email).toLowerCase(), c.id as string); createdIds.push(c.id as string) }
  }
  if (projectIds.length) {
    for (const id of known.values()) {
      const { data: have } = await supabaseAdmin.from('project_clients').select('project_id').eq('client_id', id)
      await setProjects(id, [...new Set([...(have ?? []).map(r => r.project_id as string), ...projectIds])])
    }
  }
  return NextResponse.json({ ok: true, added: fresh.length, already: emails.length - fresh.length, created_ids: createdIds })
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') patch.name = body.name.trim() || null
  if (body.lang === 'uk' || body.lang === 'en') patch.lang = body.lang
  if (typeof body.email === 'string') {
    const [email] = parseEmails(body.email)
    if (!email) return NextResponse.json({ error: 'Некоректний email' }, { status: 400 })
    patch.email = email
  }
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('clients').update(patch).eq('id', id)
    if (error) {
      return NextResponse.json({
        error: /duplicate|unique/i.test(error.message) ? 'Клієнт із таким email уже є'
          : /lang|schema cache/i.test(error.message) ? 'Запусти міграцію supabase/client_lang_migration.sql у Supabase SQL Editor'
          : error.message,
      }, { status: 400 })
    }
  }
  if (Array.isArray(body.projectIds)) await setProjects(id, body.projectIds.filter((p: unknown) => typeof p === 'string'))
  return NextResponse.json({ ok: true })
}

// Removing a client closes their access: project links go with the row
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
