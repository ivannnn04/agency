import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'

// True when the request carries the admin's NextAuth session. The middleware
// already keeps signed-out visitors away from admin API routes; this also
// keeps lead managers (who have a session too) out of admin-only ones.
export async function requireAdmin(): Promise<boolean> {
  const jar = await cookies()
  const sessionToken =
    jar.get('__Secure-next-auth.session-token')?.value ??
    jar.get('next-auth.session-token')?.value
  if (!sessionToken) return false
  const token = await decode({ token: sessionToken, secret: process.env.NEXTAUTH_SECRET! })
  return token?.role === 'admin'
}
