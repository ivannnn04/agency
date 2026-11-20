import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import supabaseAdmin from '@/lib/supabaseAdmin'

// ── Admin preview ────────────────────────────────────────────────────────────
// The admin can open the portal exactly as a client sees it. The admin API
// mints a short-lived signed token; the portal accepts it in place of a
// client's own session, for reading only.

const PREVIEW_PREFIX = 'gxp.'
const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000
const previewSecret = () => process.env.NEXTAUTH_SECRET ?? ''
const sign = (payload: string) => createHmac('sha256', previewSecret()).update(payload).digest('base64url')

interface PreviewClaims { p: string; c: string | null; n: string | null; e: string; l?: string; exp: number }

export function mintPreviewToken(
  projectId: string,
  client: { id: string; email: string; name: string | null } | null,
  lang: string = 'en',
): string {
  const claims: PreviewClaims = {
    p: projectId,
    c: client?.id ?? null,
    n: client?.name ?? null,
    l: lang,
    e: client?.email ?? 'client@preview',
    exp: Date.now() + PREVIEW_TTL_MS,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${PREVIEW_PREFIX}${payload}.${sign(payload)}`
}

function readPreviewToken(token: string): PreviewClaims | null {
  if (!previewSecret() || !token.startsWith(PREVIEW_PREFIX)) return null
  const [payload, sig] = token.slice(PREVIEW_PREFIX.length).split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as PreviewClaims
    return claims.exp > Date.now() ? claims : null
  } catch {
    return null
  }
}

// A project previewed without any client attached still needs an identity
const previewId = (projectId: string) => `preview:${projectId}`

export interface PortalClient {
  id: string
  email: string
  name: string | null
  auth_user_id: string | null
  lang?: string | null
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

  if (token.startsWith(PREVIEW_PREFIX)) {
    const claims = readPreviewToken(token)
    // Looking only: nothing may be posted in the client's name from a preview
    if (!claims || req.method !== 'GET') return { email: null, client: null }
    return {
      email: claims.e,
      client: { id: claims.c ?? previewId(claims.p), email: claims.e, name: claims.n, auth_user_id: null, lang: claims.l ?? 'en' },
    }
  }

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
  if (clientId.startsWith('preview:')) return clientId === previewId(projectId)
  const { data } = await supabaseAdmin
    .from('project_clients')
    .select('id')
    .eq('client_id', clientId)
    .eq('project_id', projectId)
    .single()
  return !!data
}
