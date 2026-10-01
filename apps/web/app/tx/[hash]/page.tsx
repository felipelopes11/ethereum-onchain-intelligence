import type { Metadata } from 'next';
import { txHashSchema } from '@eoi/shared';
import { TransactionView } from '@/components/transaction/transaction-view';
import { shortHex } from '@/lib/format';

interface Props {
  params: Promise<{ hash: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  return { title: `Transaction ${shortHex(hash, 10, 6)}` };
}

export default async function TransactionPage({ params }: Props) {
  const { hash } = await params;
  const parsed = txHashSchema.safeParse(decodeURIComponent(hash));
  if (!parsed.success) {
    return (
      <div role="alert" className="rounded-lg border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold">Invalid transaction hash</h1>
        <p className="mt-1 text-sm text-ink-2">Expected a 0x-prefixed 32-byte hex string.</p>
      </div>
    );
  }
  return <TransactionView hash={parsed.data} />;
}
