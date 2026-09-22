import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { withSpaceApp } from './space-fixture';

// Phase M4.6, architecture document section 5.7: a terminal tab moved to another group of
// the dock keeps its process, in a Space window. Playwright cannot produce the dock's native
// drag, so the move goes through the dock API the renderer publishes under COCKPIT_E2E, as
// in `cockpit.spec.ts`. The Space is a fixture in a temporary folder with its own userData.

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type DockApiLike = {
  getPanel(
    id: string,
  ): { group: { id: string }; api: { moveTo(o: { group: unknown }): void } } | undefined;
  addGroup(): { id: string };
};

test('a terminal tab moved to another group keeps its process in a Space window', async () => {
  await withSpaceApp('e2e-move-space', async ({ page, fixture }) => {
    await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('space-rail-sessions').click();
    await page.getByTestId('space-sessions-empty').getByTestId('new-shell').click();
    const dock = page.getByTestId('dock-workspace');
    await expect(dock.getByTestId('tab-shell')).toBeVisible({ timeout: 5_000 });
    const terminal = page.getByTestId('terminal').first();
    await expect(terminal).toBeVisible();

    // The shell writes its process id into the Space folder.
    await terminal.click();
    await page.keyboard.type('echo $$ > e2e-move-pid.txt');
    await page.keyboard.press('Enter');
    const pidFile = join(fixture.root, 'e2e-move-pid.txt');
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(Number.isInteger(pid) && pid > 1).toBe(true);

    // The terminal's host is the one element of the dock tagged with a tab id.
    const hostId = await page.evaluate(
      () => document.querySelector('[data-tab-host]')?.getAttribute('data-tab-host') ?? null,
    );
    expect(hostId).toBeTruthy();

    const moved = await page.evaluate((id: string) => {
      const api = (window as unknown as { __dockApi: DockApiLike }).__dockApi;
      const panel = api.getPanel(id);
      const before = panel?.group.id ?? null;
      const target = api.addGroup();
      panel?.api.moveTo({ group: target });
      return { before, after: api.getPanel(id)?.group.id ?? null };
    }, hostId as string);
    expect(moved.before).toBeTruthy();
    expect(moved.after).not.toBe(moved.before);

    // The same host element, the same process, and the process still takes input.
    await expect(page.locator(`[data-tab-host="${hostId}"]`)).toHaveCount(1);
    expect(isAlive(pid)).toBe(true);
    await page.getByTestId('terminal').first().click();
    await page.keyboard.type('echo $$ > e2e-move-pid-after.txt');
    await page.keyboard.press('Enter');
    const afterFile = join(fixture.root, 'e2e-move-pid-after.txt');
    await expect.poll(() => existsSync(afterFile), { timeout: 10_000 }).toBe(true);
    expect(Number(readFileSync(afterFile, 'utf8').trim())).toBe(pid);
  });
});
