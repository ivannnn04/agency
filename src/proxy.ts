import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth
    const { pathname } = req.nextUrl

    if (!token) return NextResponse.next()

    // Lead managers can only see their own leads area
    if (token.role === 'manager' && !pathname.startsWith('/my-leads')) {
      return NextResponse.redirect(new URL('/my-leads', req.url))
    }

    // Admins never land on the manager area
    if (token.role === 'admin' && pathname.startsWith('/my-leads')) {
      return NextResponse.redirect(new URL('/', req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: { authorized: ({ token }) => !!token },
    pages: { signIn: '/login' },
  },
)

export const config = {
  // Everything is NextAuth-protected EXCEPT:
  // - /login (admin + manager sign-in)
  // - /team/* (designer area — its own Supabase auth)
  // - /api/team/*, /api/cron/* (called by designers / scheduled jobs)
  matcher: ['/((?!login|team|api/auth|api/team|api/cron|api/seed-olga|_next/static|_next/image|favicon.ico).*)'],
}
