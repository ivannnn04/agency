import { withAuth } from 'next-auth/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export default withAuth(
  async function middleware(req: NextRequest & { nextauth: { token: any } }) {
    const { token } = req.nextauth
    const { pathname } = req.nextUrl

    // PM routes — Supabase SSR auth (separate from NextAuth)
    if (pathname.startsWith('/pm')) {
      let response = NextResponse.next({ request: req })

      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return req.cookies.getAll() },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
              response = NextResponse.next({ request: req })
              cookiesToSet.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options)
              )
            },
          },
        }
      )

      const { data: { user } } = await supabase.auth.getUser()

      if (!user && !pathname.startsWith('/pm/login')) {
        return NextResponse.redirect(new URL('/pm/login', req.url))
      }
      if (user && pathname === '/pm/login') {
        return NextResponse.redirect(new URL('/pm', req.url))
      }
      return response
    }

    // Finance routes — NextAuth role routing
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
    callbacks: {
      authorized: ({ token, req }) => {
        // PM routes bypass NextAuth entirely
        if (req.nextUrl.pathname.startsWith('/pm')) return true
        return !!token
      },
    },
    pages: { signIn: '/login' },
  },
)

export const config = {
  matcher: ['/((?!login|api/auth|api/seed-olga|_next/static|_next/image|favicon.ico).*)'],
}
