import type { Metadata } from 'next';
import { addressSchema } from '@eoi/shared';
import { AddressView } from '@/components/address/address-view';
import { shortHex } from '@/lib/format';

interface Props {
  params: Promise<{ address: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Address ${shortHex(address)}` };
}

export default async function AddressPage({ params }: Props) {
  const { address } = await params;
  const parsed = addressSchema.safeParse(decodeURIComponent(address));
  if (!parsed.success) {
    return (
      <div role="alert" className="rounded-lg border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold">Invalid address</h1>
        <p className="mt-1 text-sm text-ink-2">
          {parsed.error.issues[0]?.message ?? 'Not a valid Ethereum address'}
        </p>
      </div>
    );
  }
  return <AddressView address={parsed.data} />;
}
