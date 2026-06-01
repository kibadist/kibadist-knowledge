import type { Metadata } from 'next'
import { Fraunces, Inter, JetBrains_Mono, Newsreader } from 'next/font/google'

import './globals.css'
import { Providers } from './providers'

// The three brand families, role-divided (see the Kibadist design system):
// Fraunces (display serif, with the SOFT axis), Newsreader (serif body), and
// JetBrains Mono (every label / kicker / caption). Each exposes the CSS variable
// the editorial token layer reads (`--font-display` / `--font-body` / `--font-mono`).
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-display',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-body',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '700'],
  variable: '--font-mono',
})

// Base UI sans for body text.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Kibadist Knowledge',
  description: 'AI asks questions. Humans build understanding.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang='en'
      className={`${fraunces.variable} ${newsreader.variable} ${jetbrainsMono.variable} ${inter.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
