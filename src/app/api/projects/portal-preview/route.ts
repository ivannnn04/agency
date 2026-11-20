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
  const token = mintPreviewToken(projectId, client)
  return NextResponse.json({
    url: `/portal/project/${projectId}?preview=${encodeURIComponent(token)}`,
    clients,
    client_id: client?.id ?? null,
  })
}
