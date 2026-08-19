import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { getPortalUser, clientHasProject } from '@/lib/portalAuth'

// Client side of project invoices — read-only.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client } = await getPortalUser(req)
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await clientHasProject(client.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: invoices } = await supabaseAdmin
    .from('project_invoices')
    .select('id, title, amount, currency, file_url, file_name, status, created_at, paid_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ invoices: invoices ?? [] })
}
