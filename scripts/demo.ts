/**
 * End-to-end health check and guided demo:
 *   1. Ethereum RPC connectivity      4. current block
 *   2. PostgreSQL connectivity        5. indexer status (checkpoint, lag, coverage)
 *   3. chain id                       6. an example query against live indexed data
 *
 * Usage: npm run demo   (reads .env via --env-file if present; see package.json)
 */
import { EvmProvider, describeError, viemChainFor } from '@eoi/blockchain';
import { redactUrl } from '@eoi/config';
import { AddressQueries, createDatabase, ExampleQueries, IngestionRepository } from '@eoi/database';
import { getChainInfo } from '@eoi/shared';

const rpcUrl = process.env.ETHEREUM_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://eoi:eoi@localhost:5432/eoi';
const chainId = Number(process.env.ETHEREUM_CHAIN_ID ?? 11155111);
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let failures = 0;
const ok = (label: string, detail: string) => console.log(`  [ok]   ${label.padEnd(22)} ${detail}`);
const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  [fail] ${label.padEnd(22)} ${detail}`);
};

console.log('\nEthereum On-Chain Intelligence: demo\n');

const chain = getChainInfo(chainId);
const provider = new EvmProvider({ rpcUrl, chainId, chain: viemChainFor(chainId), maxRetries: 2 });

let head: bigint | null = null;
try {
  const remoteChainId = await provider.getChainId();
  ok('RPC', redactUrl(rpcUrl));
  if (remoteChainId === chainId) ok('Chain ID', `${remoteChainId} (${chain?.name ?? 'unknown'})`);
  else fail('Chain ID', `RPC serves ${remoteChainId}, configuration expects ${chainId}`);
  head = await provider.getLatestBlockNumber();
  ok('Current block', head.toString());
} catch (error) {
  fail('RPC', `${redactUrl(rpcUrl)}: ${describeError(error)}`);
}

const database = createDatabase(databaseUrl, { maxConnections: 2 });
try {
  await database.ping();
  ok('PostgreSQL', redactUrl(databaseUrl));

  const checkpoint = await new IngestionRepository(database.db, chainId).getCheckpoint();
  if (!checkpoint) {
    fail(
      'Indexer',
      'no checkpoint yet: start the indexer (npm run dev:indexer or docker compose up)',
    );
  } else {
    const lag = head !== null ? head - checkpoint.blockNumber : null;
    ok('Indexer checkpoint', `block ${checkpoint.blockNumber} (${lag ?? '?'} behind head)`);
    ok('Coverage', `blocks ${checkpoint.startBlock}–${checkpoint.blockNumber}`);

    const examples = await new ExampleQueries(database.db, chainId).pick();
    const target = examples.find((e) => e.kind === 'protocol-user' || e.kind === 'active-address');
    if (target) {
      const summary = await new AddressQueries(database.db, chainId).activitySummary(target.value);
      ok('Example query', target.value);
      console.log(`         ${target.description}`);
      console.log(
        `         ${summary.sent} sent / ${summary.received} received, ${summary.distinctTokens} token contracts, ` +
          `first seen block ${summary.firstSeen?.blockNumber ?? '—'}`,
      );
    }
    console.log('\n  Try these (taken from the current index, not hard-coded):');
    for (const example of examples) {
      const path = example.value.length === 66 ? `tx/${example.value}` : `address/${example.value}`;
      console.log(`    - ${example.description}\n      UI:  http://localhost:3000/${path}`);
    }
    console.log(`\n  API:  curl ${apiUrl}/api/status`);
  }
} catch (error) {
  fail('PostgreSQL', `${redactUrl(databaseUrl)}: ${describeError(error)}`);
} finally {
  await database.close();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
