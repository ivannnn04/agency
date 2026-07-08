import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  // Everything is admin-protected EXCEPT:
  // - /login (admin sign-in)
  // - /team/* (designer area — its own Supabase auth)
  // - /api/team/*, /api/cron/* (called by designers / scheduled jobs)
  matcher: ['/((?!login|team|api/auth|api/team|api/cron|api/seed-olga|_next/static|_next/image|favicon.ico).*)'],
}
