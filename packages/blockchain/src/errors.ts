import {
  BaseError,
  BlockNotFoundError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InternalRpcError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ResourceUnavailableRpcError,
  RpcRequestError,
  TimeoutError,
  TransactionReceiptNotFoundError,
} from 'viem';
import { DataInconsistencyError } from './provider';

function findCause<T extends Error>(
  error: unknown,
  type: abstract new (...args: never[]) => T,
): T | null {
  if (error instanceof type) return error;
  if (error instanceof BaseError) {
    const found = error.walk((cause) => cause instanceof type);
    return found instanceof type ? found : null;
  }
  return null;
}

/** JSON-RPC codes used by geth/erigon/nethermind for transient "not yet available" states. */
const TRANSIENT_RPC_CODES = new Set([-32000, -32002, -32005, -32603]);
const TRANSIENT_MESSAGE =
  /header not found|unknown block|rate limit|too many requests|timeout|temporarily/i;

/**
 * Classifies RPC failures. Retrying is only safe for transient conditions; retrying
 * invalid params or reverted calls just burns rate limit.
 */
export function isRetryableRpcError(error: unknown): boolean {
  if (error instanceof DataInconsistencyError) return true;
  if (findCause(error, TimeoutError)) return true;
  if (findCause(error, LimitExceededRpcError)) return true;
  if (findCause(error, ResourceUnavailableRpcError)) return true;
  if (findCause(error, InternalRpcError)) return true;
  // A load-balanced endpoint can report a head that a lagging backend has not seen yet.
  if (findCause(error, BlockNotFoundError)) return true;
  if (findCause(error, TransactionReceiptNotFoundError)) return false;

  const http = findCause(error, HttpRequestError);
  if (http)
    return (
      http.status === undefined || http.status === 408 || http.status === 429 || http.status >= 500
    );

  const rpc = findCause(error, RpcRequestError);
  if (rpc) return TRANSIENT_RPC_CODES.has(rpc.code) || TRANSIENT_MESSAGE.test(rpc.details);

  if (
    error instanceof Error &&
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(error.message)
  ) {
    return true;
  }
  return false;
}

export function isExecutionRevertError(error: unknown): boolean {
  if (findCause(error, ContractFunctionRevertedError)) return true;
  const rpc = findCause(error, RpcRequestError);
  if (rpc?.code === 3) return true;
  return error instanceof BaseError && /execution reverted|reverted/i.test(error.shortMessage);
}

export function isMethodUnsupportedError(error: unknown): boolean {
  return (
    findCause(error, MethodNotFoundRpcError) !== null ||
    findCause(error, MethodNotSupportedRpcError) !== null ||
    findCause(error, InvalidParamsRpcError) !== null
  );
}

/** Short, log-safe description of an error (never includes request bodies or URLs). */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) return `${error.name}: ${error.shortMessage}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
