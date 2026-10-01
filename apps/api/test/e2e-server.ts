/**
 * Deterministic API for Playwright: in-memory Postgres seeded with fixture blocks and a
 * stub RPC provider. E2E tests then exercise the real web app and real API code
 * without depending on a live testnet whose state changes over time.
 */
import { SWAP_INPUT, alice, createHarness } from './harness';

const port = Number(process.env.E2E_API_PORT ?? 4010);
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100';

const harness = await createHarness(undefined, { corsOrigins: [webOrigin] });
await harness.app.listen({ host: '127.0.0.1', port });
console.warn(
  `E2E API listening on http://127.0.0.1:${port} (fixture address ${alice}, swap selector ${SWAP_INPUT.slice(0, 10)})`,
);

const shutdown = () => {
  void harness.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
