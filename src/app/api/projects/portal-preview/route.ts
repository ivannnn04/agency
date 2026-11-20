import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { mintPreviewToken } from '@/lib/portalAuth'

// Lets the admin open a project's client portal exactly as a client sees it.
// Returns a short-lived read-only preview link. Admin-only via the NextAuth
// middleware (this route is not under the public /api/portal prefix).

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project') ?? ''
  const wanted = req.nextUrl.searchParams.get('client')
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })

  const { data: links } = await supabaseAdmin
    .from('project_clients')
    .select('clients(id, email, name)')
    .eq('project_id', projectId)
  const clients = ((links ?? []) as unknown as { clients: { id: string; email: string; name: string | null } | null }[])
    .map(l => l.clients)
    .filter((c): c is { id: string; email: string; name: string | null } => !!c)

  const client = clients.find(c => c.id === wanted) ?? clients[0] ?? null

  // The client's language setting; `lang` in the query previews the other
  // one without saving. Read separately: the column comes with a migration.
  let lang = 'en'
  if (client) {
    const { data } = await supabaseAdmin.from('clients').select('lang').eq('id', client.id).maybeSingle()
    if (data?.lang === 'uk') lang = 'uk'
  }
  const override = req.nextUrl.searchParams.get('lang')
  if (override === 'uk' || override === 'en') lang = override

  const token = mintPreviewToken(projectId, client, lang)
  return NextResponse.json({
    url: `/portal/project/${projectId}?preview=${encodeURIComponent(token)}`,
    clients,
    client_id: client?.id ?? null,
    lang,
  })
}

// Set the language of a client's workspace
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const lang = body?.lang === 'uk' ? 'uk' : 'en'
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('clients').update({ lang }).eq('id', clientId)
  if (error) {
    return NextResponse.json({
      error: /lang|schema cache/i.test(error.message)
        ? 'Запусти міграцію supabase/client_lang_migration.sql у Supabase SQL Editor'
        : error.message,
    }, { status: 400 })
  }
  return NextResponse.json({ ok: true, lang })
}
