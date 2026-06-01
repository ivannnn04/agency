import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, hash] = parts
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return computed === hash
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const { data: mgr } = await supabase
          .from('lead_managers')
          .select('id,name,email,password_hash,is_active')
          .eq('email', credentials.email.toLowerCase().trim())
          .eq('is_active', true)
          .single()
        if (!mgr || !verifyPassword(credentials.password, mgr.password_hash)) return null
        return { id: mgr.id, email: mgr.email, name: mgr.name }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const allowed = (process.env.ALLOWED_EMAIL ?? '').split(',').map(e => e.trim())
        return allowed.includes(user.email ?? '')
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.role      = account?.provider === 'google' ? 'admin' : 'manager'
        token.managerId = account?.provider === 'credentials' ? user.id : undefined
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role      = token.role as 'admin' | 'manager'
        session.user.managerId = token.managerId as string | undefined
      }
      return session
    },
  },
  pages: { signIn: '/login', error: '/login' },
})

export { handler as GET, handler as POST }
