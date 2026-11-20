import Link from 'next/link'

// Shared frame for the public legal pages (privacy policy, terms of service).
// They are linked from the client sign-in page and from the Google sign-in
// consent screen, so they must be readable without an account.

export const LEGAL_CONTACT = 'hello@gudrix.com'
export const LEGAL_UPDATED = 'November 20, 2026'

export interface LegalSection { title: string; body: React.ReactNode }

export default function LegalPage({ title, intro, sections }: {
  title: string
  intro: React.ReactNode
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="on-dark bg-[#09090b]">
        <div className="px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-4">
          <Link href="/portal/login" className="text-white font-extrabold text-xl tracking-tight leading-none lowercase">
            gudrix<span className="text-[#2affaa]">.</span>
          </Link>
          <nav className="flex items-center gap-6 text-[13px] text-white/60">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/portal/login" className="hover:text-white transition-colors">Client sign in</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 px-5 sm:px-8 lg:px-12 py-14 lg:py-20">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Last updated {LEGAL_UPDATED}</p>
          <h1 className="text-4xl sm:text-5xl font-semibold text-gray-900 tracking-tight mt-4">{title}</h1>
          <div className="text-lg text-gray-600 leading-relaxed mt-6">{intro}</div>

          <div className="mt-12 divide-y divide-gray-100 border-t border-gray-100">
            {sections.map((s, i) => (
              <section key={s.title} className="py-9">
                <h2 className="text-xl font-semibold text-gray-900 tracking-tight flex gap-3">
                  <span className="text-gray-300 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </h2>
                <div className="mt-4 text-[15px] text-gray-600 leading-relaxed flex flex-col gap-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_a]:text-gray-900 [&_a]:underline [&_strong]:text-gray-900 [&_strong]:font-medium">
                  {s.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 px-5 sm:px-8 lg:px-12 py-6 text-xs text-gray-400 flex items-center justify-between gap-4 flex-wrap">
        <span>© {new Date().getFullYear()} Gudrix</span>
        <a href={`mailto:${LEGAL_CONTACT}`} className="hover:text-gray-900 transition-colors">{LEGAL_CONTACT}</a>
      </footer>
    </div>
  )
}
