import { test, expect, type Page } from '@playwright/test';

// These run against whatever clips are in src/assets/media, and skip until the
// site has at least one local player.
async function firstPlayer(page: Page) {
  await page.goto('/');
  const player = page.locator('[data-player]').first();
  test.skip((await player.count()) === 0, 'no clips in src/assets/media');
  return player;
}

const isPlaying = (player: ReturnType<Page['locator']>) =>
  player.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused);

test.describe('local player', () => {
  test('nothing downloads until play is pressed', async ({ page }) => {
    const player = await firstPlayer(page);
    const readyState = await player.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState);
    expect(readyState).toBe(0);
  });

  test('play and pause toggle playback and the label', async ({ page }) => {
    const player = await firstPlayer(page);
    const toggle = player.locator('[data-toggle]');
    await toggle.click();
    await expect.poll(() => isPlaying(player)).toBe(true);
    await expect(toggle).toHaveAttribute('aria-label', /^Pause /);
    await toggle.click();
    await expect.poll(() => isPlaying(player)).toBe(false);
    await expect(toggle).toHaveAttribute('aria-label', /^Play /);
  });

  test('seeking moves the playhead', async ({ page }) => {
    const player = await firstPlayer(page);
    await player.locator('[data-toggle]').click();
    await expect.poll(() => isPlaying(player)).toBe(true);
    await player.locator('[data-seek]').fill('50');
    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime / a.duration))
      .toBeGreaterThan(0.4);
  });

  test('only one player plays at a time', async ({ page }) => {
    await firstPlayer(page);
    const players = page.locator('[data-player]');
    test.skip((await players.count()) < 2, 'needs two local players');
    await players.nth(0).locator('[data-toggle]').click();
    await expect.poll(() => isPlaying(players.nth(0))).toBe(true);
    await players.nth(1).locator('[data-toggle]').click();
    await expect.poll(() => isPlaying(players.nth(1))).toBe(true);
    await expect.poll(() => isPlaying(players.nth(0))).toBe(false);
  });

  test('a seek made before the clip loads is kept', async ({ page }) => {
    const player = await firstPlayer(page);
    await player.locator('[data-seek]').fill('50');
    await player.locator('[data-toggle]').click();
    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime / a.duration))
      .toBeGreaterThan(0.4);
  });

  test('EP tracks can be picked and advance on their own', async ({ page }) => {
    await firstPlayer(page);
    const player = page.locator('[data-player]:has([data-track])').first();
    test.skip((await player.count()) === 0, 'needs a local EP');
    const tracks = player.locator('[data-track]');
    await tracks.nth(1).click();
    await expect(tracks.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(tracks.nth(0)).toHaveAttribute('aria-current', 'false');
    await expect.poll(() => isPlaying(player)).toBe(true);

    await player.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.dispatchEvent(new Event('ended'));
    });
    await expect(tracks.nth(2)).toHaveAttribute('aria-current', 'true');
  });

  test('a clip that fails to load shows the error message', async ({ page }) => {
    await page.route('**/*.mp3', (route) => route.abort());
    const player = await firstPlayer(page);
    await player.locator('[data-toggle]').click();
    await expect(player.locator('[data-error]')).toBeVisible();
    await expect(player.locator('[data-toggle]')).toBeDisabled();
  });
});
