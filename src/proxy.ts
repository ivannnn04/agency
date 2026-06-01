import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth
    const { pathname } = req.nextUrl

    if (!token) return NextResponse.next()

    if (token.role === 'manager' && !pathname.startsWith('/my-leads')) {
      return NextResponse.redirect(new URL('/my-leads', req.url))
    }

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
  matcher: ['/((?!login|api/auth|api/seed-olga|_next/static|_next/image|favicon.ico).*)'],
}
