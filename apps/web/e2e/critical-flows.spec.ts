import { expect, test } from '@playwright/test';

// Fixture data served by apps/api/test/e2e-server.ts (see apps/api/test/harness.ts).
const ALICE = '0x7afb84bbe6214c4dd90a6e17d9dc1d3c062b3438';

test.describe('search', () => {
  test('searching an address opens the address page', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Ethereum On-Chain Intelligence' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Search Ethereum address or transaction hash' })
      .fill(ALICE);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page).toHaveURL(`/address/${ALICE}`);
    await expect(page.getByTestId('address-heading')).toContainText(ALICE);
  });

  test('invalid input is rejected with a clear message and no navigation', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Search Ethereum address or transaction hash' })
      .fill('0x1234');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /[a-z]/ })).toContainText(
      '20-byte address',
    );
    await expect(page).toHaveURL('/');
  });

  test('a transaction hash routes to the transaction page', async ({ page }) => {
    await page.goto(`/address/${ALICE}`);
    await page.getByRole('tab', { name: 'Transactions' }).click();
    const hash = await page.locator('a[href^="/tx/"]').first().getAttribute('title');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Search Ethereum address or transaction hash' })
      .fill(hash!);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/tx/${hash}`);
    await expect(page.getByTestId('tx-heading')).toContainText(hash!);
  });
});

test.describe('address page', () => {
  test('shows indexed summary, coverage and tabs', async ({ page }) => {
    await page.goto(`/address/${ALICE}`);
    await expect(page.getByTestId('kind-badge')).toHaveText('EOA');
    await expect(
      page.getByText('Based on indexed blocks 1–30', { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText('Uniswap').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Transactions' }).click();
    await expect(page.getByRole('row')).toHaveCount(26);
    await page.getByRole('button', { name: 'Load older transactions' }).click();
    await expect(page.getByRole('row')).toHaveCount(46);
  });

  test('Explain this wallet shows evidence, unknowns and limitations', async ({ page }) => {
    await page.goto(`/address/${ALICE}`);
    await page.getByRole('tab', { name: 'Analysis' }).click();
    const report = page.getByTestId('explain-report');
    await expect(report.getByText('Likely DeFi participant')).toBeVisible();
    await expect(report.getByText('Swap-related transactions')).toBeVisible();
    await expect(report.getByText('Owner identity is unknown', { exact: false })).toBeVisible();
    await expect(report.getByRole('heading', { name: 'Limitations' })).toBeVisible();
  });
});

test.describe('transaction page', () => {
  test('decodes the call and renders transfer events readably', async ({ page }) => {
    await page.goto(`/address/${ALICE}`);
    await page.getByRole('tab', { name: 'Transactions' }).click();
    await page
      .getByRole('row', { name: /exactInputSingle/ })
      .first()
      .locator('a[href^="/tx/"]')
      .click();

    await expect(page.getByText('exactInputSingle(', { exact: false })).toBeVisible();
    await expect(page.getByText('✓ Success')).toBeVisible();
    await expect(page.getByTestId('transfer-amount')).toContainText('25 USDC');
    await page.getByText('View raw event').first().click();
    await expect(page.getByText('topic0:').first()).toBeVisible();
  });

  test('unknown transactions show a clear not-found error', async ({ page }) => {
    await page.goto(`/tx/0x${'00'.repeat(32)}`);
    await expect(page.getByRole('alert').filter({ hasText: /[a-z]/ })).toContainText('not found');
  });
});
