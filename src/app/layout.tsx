import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NORD Studio – WIP',
  description: 'Vad jobbar du med?',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  )
}