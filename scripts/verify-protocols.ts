/**
 * Verifies the protocol registry against the chain instead of trusting it:
 * every registered contract must have bytecode, and contracts with a declared
 * verification probe must answer it with the expected value (e.g. a router's
 * factory() must return the registered factory).
 */
import { decodeFunctionResult, encodeFunctionData, parseAbiItem, type AbiFunction } from 'viem';
import { EvmProvider, ProtocolRegistry, describeError, viemChainFor } from '@eoi/blockchain';
import { redactUrl } from '@eoi/config';

const rpcUrl = process.env.ETHEREUM_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const chainId = Number(process.env.ETHEREUM_CHAIN_ID ?? 11155111);

const provider = new EvmProvider({ rpcUrl, chainId, chain: viemChainFor(chainId), maxRetries: 2 });
const registry = new ProtocolRegistry(chainId);
let failures = 0;

console.log(`Verifying protocol registry for chain ${chainId} via ${redactUrl(rpcUrl)}\n`);

for (const { protocol, contract } of registry.contracts()) {
  const label = `${protocol.name.padEnd(9)} ${contract.role.padEnd(26)} ${contract.address}`;
  try {
    const code = await provider.getCode(contract.address);
    if (!code) {
      failures++;
      console.log(`  [fail] ${label}  no bytecode`);
      continue;
    }
    const probe = contract.verification;
    if (!probe) {
      console.log(`  [ok]   ${label}  bytecode ${(code.length - 2) / 2} bytes (no probe)`);
      continue;
    }
    const fn = parseAbiItem(probe.functionSignature) as AbiFunction;
    const [result] = await provider.readContracts([
      { address: contract.address, data: encodeFunctionData({ abi: [fn], functionName: fn.name }) },
    ]);
    if (!result?.success) throw new Error(`probe ${fn.name}() reverted`);
    const value = decodeFunctionResult({
      abi: [fn],
      functionName: fn.name,
      data: result.data,
    }) as unknown;
    const passed =
      probe.expect.kind === 'address'
        ? String(value).toLowerCase() === probe.expect.equals.toLowerCase()
        : value !== 0n && value !== '0x0000000000000000000000000000000000000000';
    if (!passed) failures++;
    console.log(`  ${passed ? '[ok]  ' : '[fail]'} ${label}  ${fn.name}() = ${String(value)}`);
  } catch (error) {
    failures++;
    console.log(`  [fail] ${label}  ${describeError(error)}`);
  }
}

console.log(
  failures === 0
    ? '\nRegistry verified on-chain.'
    : `\n${failures} contract(s) failed verification.`,
);
process.exit(failures === 0 ? 0 : 1);
