import { NextRequest } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

export interface PortalClient {
  id: string
  email: string
  name: string | null
  auth_user_id: string | null
}

// Verifies the Supabase access token from the Authorization header and
// resolves the matching client record (by email). All portal API routes go
// through this so project data is only ever served server-side to a client
// the admin explicitly attached to a project.
export async function getPortalUser(req: NextRequest): Promise<{
  email: string | null
  client: PortalClient | null
}> {
  const auth = req.headers.get('authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { email: null, client: null }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user?.email) return { email: null, client: null }

  const email = user.email.toLowerCase()
  const { data: client } = await supabaseAdmin
    .from('clients').select('*').eq('email', email).single()

  // Link the auth account on first authenticated visit
  if (client && !client.auth_user_id) {
    await supabaseAdmin.from('clients').update({ auth_user_id: user.id }).eq('id', client.id)
  }

  return { email, client: (client as PortalClient) ?? null }
}

export async function clientHasProject(clientId: string, projectId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('project_clients')
    .select('id')
    .eq('client_id', clientId)
    .eq('project_id', projectId)
    .single()
  return !!data
}
