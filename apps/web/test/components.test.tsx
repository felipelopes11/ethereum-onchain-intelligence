import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedEventDto } from '@eoi/shared';
import { ActivityTimeline } from '@/components/charts/activity-timeline';
import { EventCard } from '@/components/transaction/event-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const token = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';
const alice = '0x440d4935489dab4d84197947dc0c014c125ceb22';

function event(overrides: Partial<DecodedEventDto>): DecodedEventDto {
  return {
    logIndex: 3,
    address: token,
    status: 'decoded',
    name: 'Transfer',
    signature: 'Transfer(address,address,uint256)',
    abiSource: 'erc20',
    args: [],
    transfer: [],
    raw: { topics: [`0x${'dd'.repeat(32)}`], data: '0x' },
    ...overrides,
  };
}

describe('EventCard', () => {
  it('renders ERC-20 transfers readably with the self-declared symbol flagged', () => {
    render(
      <ul>
        <EventCard
          event={event({
            transfer: [
              {
                standard: 'erc20',
                from: alice,
                to: token,
                amount: { token, symbol: 'USDC', decimals: 6, raw: '1250000000' },
                tokenId: null,
              },
            ],
          })}
        />
      </ul>,
    );
    expect(screen.getByTestId('transfer-amount').textContent).toContain('1,250 USDC');
    expect(screen.getByText(/self-declared/)).toBeTruthy();
    expect(screen.getByText('View raw event')).toBeTruthy();
  });

  it('labels unknown events and shows the raw log instead of guessing', () => {
    render(
      <ul>
        <EventCard
          event={event({ status: 'unknown', name: null, signature: null, abiSource: null })}
        />
      </ul>,
    );
    expect(screen.getByText('Unknown event')).toBeTruthy();
    expect(screen.getByText(/No known ABI matches topic0/)).toBeTruthy();
  });

  it('renders hostile token metadata as inert text (no HTML injection)', () => {
    const { container } = render(
      <ul>
        <EventCard
          event={event({
            transfer: [
              {
                standard: 'erc20',
                from: alice,
                to: token,
                amount: { token, symbol: '<img src=x onerror=alert(1)>', decimals: 0, raw: '1' },
                tokenId: null,
              },
            ],
          })}
        />
      </ul>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('transfer-amount').textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });
});

describe('ActivityTimeline', () => {
  it('draws one bar segment per non-zero series and offers a table view', () => {
    const { container } = render(
      <ActivityTimeline
        unit="hour"
        buckets={[
          { start: '2026-10-01T12:00:00Z', outgoing: 5, incoming: 2 },
          { start: '2026-10-01T13:00:00Z', outgoing: 0, incoming: 1 },
        ]}
      />,
    );
    const filled = [...container.querySelectorAll('rect')].filter((r) =>
      r.getAttribute('fill')?.startsWith('var(--series'),
    );
    expect(filled).toHaveLength(3);
    expect(screen.getByText('View data as table')).toBeTruthy();
  });

  it('says so when there is nothing to plot', () => {
    render(<ActivityTimeline unit="day" buckets={[]} />);
    expect(screen.getByText(/No transactions in the indexed range/)).toBeTruthy();
  });
});
