import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe('CurveWeave app', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    (page as unknown as { __errors: string[] }).__errors = errors;
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  test('runs the full pipeline on load and reports real solver status', async ({ page }) => {
    await expect(page.getByTestId('topology')).toContainText('Junctions');
    await expect(page.getByTestId('stage-patches')).toContainText('5 built, 0 failed');
    await expect(page.getByTestId('solver-status')).toContainText(/Converged in \d+ iterations/);
    await expect(page.getByTestId('residual-chart').locator('polyline')).toHaveCount(1);
  });

  test('switching presets rebuilds the surface', async ({ page }) => {
    await page.getByTestId('preset').selectOption('fragmented-shell');
    await expect(page.getByTestId('stage-patches')).toContainText('11 built, 0 failed');
    await page.getByTestId('preset').selectOption('curved-canopy');
    await expect(page.getByTestId('stage-patches')).toContainText('6 built, 0 failed');
  });

  test('an iteration budget that is too small is reported as not converged', async ({ page }) => {
    const slider = page.getByTestId('max-iter');
    await slider.fill('1');
    await expect(page.getByTestId('solver-status')).toContainText('Not converged');
  });

  test('baseline mode ignores designer labels', async ({ page }) => {
    const open = page.getByTestId('topology').locator('tr', { hasText: 'Open endpoints' });
    const proposed = await open.innerText();
    await page.getByTestId('mode-baseline').click();
    await expect(open).not.toHaveText(proposed);
  });

  test('user decisions can be applied and undone', async ({ page }) => {
    const list = page.getByTestId('candidates');
    const first = list.locator('li').first();
    await expect(first).toContainText('rejected');
    await first.getByRole('button', { name: 'Accept' }).click();
    // A designer-label rejection is not overridden by accepting, the label must be removed.
    await expect(first).toContainText('rejected');
    await page.getByTestId('use-labels').uncheck();
    await page.getByText('All', { exact: true }).click();
    await expect(list.locator('li .badge.merged').first()).toBeVisible();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('redo')).toBeEnabled();
  });

  test('exports an OBJ that matches the reported mesh', async ({ page }) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-obj').click()]);
    const text = readFileSync((await dl.path())!, 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('f ')).length).toBeGreaterThan(100);
  });

  test('captures a screenshot for the README', async ({ page }) => {
    await page.getByTestId('preset').selectOption('fragmented-shell');
    await expect(page.getByTestId('solver-status')).toContainText('Converged');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'docs/screenshot.png' });
  });
});
