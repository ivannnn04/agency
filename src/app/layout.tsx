import type { Metadata, Viewport } from 'next'
import { Manrope } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// The agency site's DM Sans has no Cyrillic — Manrope is its closest
// geometric cousin that speaks Ukrainian
const brandFont = Manrope({ subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'Gudrix Cowork Space',
  description: 'Gudrix Cowork Space',
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: {
    capable: true,
    title: 'Gudrix',
    // Opaque status bar: content starts BELOW the clock/battery strip —
    // 'black-translucent' overlaid it and swallowed taps on the burger
    statusBarStyle: 'black',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#00140c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className="h-full" suppressHydrationWarning>
      <body className={`${brandFont.className} h-full`}>
        {/* Apply the saved theme before first paint to avoid a light flash */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('gudrix:theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
