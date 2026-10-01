import type {
  AddressActivityDto,
  AddressSummaryDto,
  ApiErrorDto,
  CoverageDto,
  ExplainReportDto,
  IndexerStatusDto,
  Paginated,
  ProtocolInteractionDto,
  SearchResultDto,
  TokenHoldingDto,
  TransactionDetailDto,
  TransactionListItemDto,
} from '@eoi/shared';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function isApiError(value: unknown): value is ApiErrorDto {
  return typeof value === 'object' && value !== null && 'error' in value;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      signal,
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'The API is unreachable. Is it running?');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiError(body))
      throw new ApiRequestError(response.status, body.error.code, body.error.message);
    throw new ApiRequestError(
      response.status,
      'HTTP_ERROR',
      `Request failed with status ${response.status}`,
    );
  }
  return body as T;
}

const enc = encodeURIComponent;

export interface ProtocolsResponse {
  coverage: CoverageDto;
  protocols: ProtocolInteractionDto[];
  actions: {
    protocolId: string;
    protocolName: string;
    category: string;
    action: string | null;
    transactionCount: number;
  }[];
}

export interface ExampleItem {
  kind: string;
  value: `0x${string}`;
  description: string;
}

export const api = {
  status: (signal?: AbortSignal) =>
    request<IndexerStatusDto & { chainName: string }>('/api/status', signal),
  examples: (signal?: AbortSignal) => request<{ items: ExampleItem[] }>('/api/examples', signal),
  search: (q: string, signal?: AbortSignal) =>
    request<SearchResultDto>(`/api/search?q=${enc(q)}`, signal),
  address: (address: string, signal?: AbortSignal) =>
    request<AddressSummaryDto>(`/api/address/${enc(address)}`, signal),
  transactions: (address: string, cursor: string | null, signal?: AbortSignal) =>
    request<Paginated<TransactionListItemDto>>(
      `/api/address/${enc(address)}/transactions?limit=25${cursor ? `&cursor=${enc(cursor)}` : ''}`,
      signal,
    ),
  tokens: (address: string, signal?: AbortSignal) =>
    request<{ coverage: CoverageDto; items: TokenHoldingDto[] }>(
      `/api/address/${enc(address)}/tokens`,
      signal,
    ),
  protocols: (address: string, signal?: AbortSignal) =>
    request<ProtocolsResponse>(`/api/address/${enc(address)}/protocols`, signal),
  activity: (address: string, signal?: AbortSignal) =>
    request<AddressActivityDto>(`/api/address/${enc(address)}/activity`, signal),
  explain: (address: string, signal?: AbortSignal) =>
    request<ExplainReportDto>(`/api/address/${enc(address)}/explain`, signal),
  transaction: (hash: string, signal?: AbortSignal) =>
    request<TransactionDetailDto>(`/api/transaction/${enc(hash)}`, signal),
};
