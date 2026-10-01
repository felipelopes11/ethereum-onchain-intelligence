import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Methodology' };

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Where the data comes from',
    items: [
      'A custom indexer reads Ethereum Sepolia over JSON-RPC: blocks with transactions, receipts (eth_getBlockReceipts) and logs.',
      'Only blocks at least CONFIRMATIONS deep are indexed. Each block must extend the previous one (parentHash); otherwise the indexer rolls back to the common ancestor.',
      'Balances, nonces and bytecode are live RPC reads and show the block they were read at.',
    ],
  },
  {
    title: 'Three kinds of statements',
    items: [
      'Observed: read directly from chain data, e.g. "signed 93 transactions" or "eth_getCode returned empty bytecode at block N".',
      'Inferred: derived deterministically from observed data, e.g. a log with the ERC-20 Transfer layout is treated as an ERC-20 transfer.',
      'Heuristic: a rule with an explicit threshold, e.g. "Likely DeFi participant" after ≥ 3 calls to known DeFi contracts. Heuristics can be wrong.',
    ],
  },
  {
    title: 'What is never claimed',
    items: [
      'Who owns an address, what they intended, or what they did off-chain.',
      'That a token named "USDC" is Circle\'s USDC: names and symbols are self-declared by contracts.',
      'Protocol membership based on event shapes: only contracts in an explicit, on-chain-verified registry count.',
      'Balances computed from transfers: token "net flow" only covers the indexed range.',
    ],
  },
  {
    title: 'Known limitations',
    items: [
      'Internal transactions (value moved inside contract calls) are not traced.',
      'Activity before the first indexed block is not analysed.',
      'Since EIP-7702, EOAs can have delegated code and emit logs; accounts that signed transactions are always reported as EOAs.',
    ],
  },
];

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-2 text-ink-2">
          How this platform turns public Ethereum data into statements you can verify. The full
          technical documentation lives in the repository&apos;s{' '}
          <code className="font-mono text-sm">docs/</code> directory.
        </p>
      </header>
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h2 className="text-lg font-semibold">{section.title}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
