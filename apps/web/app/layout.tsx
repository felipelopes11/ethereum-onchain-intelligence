import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IndexerStatusBadge } from '@/components/indexer-status';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Ethereum On-Chain Intelligence', template: '%s · On-Chain Intelligence' },
  description: 'Explore Ethereum activity using verifiable on-chain data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span
                  aria-hidden
                  className="inline-block h-5 w-5 rotate-45 rounded-sm border-2 border-accent"
                />
                On-Chain Intelligence
              </Link>
              <nav className="flex items-center gap-4 text-sm text-ink-2">
                <IndexerStatusBadge />
                <Link href="/about" className="hover:text-ink">
                  Methodology
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
            Data is read from public Ethereum blocks, receipts and logs. Classifications are
            heuristics, not facts. Never share a private key or seed phrase; this site never asks
            for one.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
