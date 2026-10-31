import { test, expect, type Page } from '@playwright/test';

// These run against the real clips in src/assets/media.
async function firstPlayer(page: Page) {
  await page.goto('/');
  const player = page.locator('[data-player]').first();
  await expect(player).toBeVisible();
  return player;
}

const isPlaying = (player: ReturnType<Page['locator']>) =>
  player.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused);

test.describe('local player', () => {
  test('a release with a clip uses it instead of the Spotify embed', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('#releases article').filter({ hasText: "Didn't you want something?" });
    await expect(card.locator('[data-player]')).toBeVisible();
    await expect(card.locator('iframe')).toHaveCount(0);
    await expect(card.locator('[data-player] img')).toHaveAttribute('src', /\/_astro\/.*\.webp/);
  });

  test('the release page shows the local cover and player', async ({ page }) => {
    await page.goto('/releases/didnt-you-want-something');
    await expect(page.locator('[data-player]')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('section img').first()).toHaveAttribute('src', /\/_astro\/.*\.webp/);
  });

  test('a release without clips keeps its Spotify embed', async ({ page }) => {
    await page.goto('/releases/fall-in-love');
    await expect(page.locator('iframe[src*="open.spotify.com/embed"]')).toBeVisible();
    await expect(page.locator('[data-player]')).toHaveCount(0);
  });

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

  test('starting another audio element pauses the player', async ({ page }) => {
    const player = await firstPlayer(page);
    await player.locator('[data-toggle]').click();
    await expect(player.locator('[data-toggle]')).toHaveAttribute('aria-label', /^Pause /);
    // A second copy of the clip stands in for another card's player.
    await page.evaluate(async () => {
      const other = document.createElement('audio');
      other.src = document.querySelector('audio')!.src;
      other.muted = true;
      document.body.append(other);
      await other.play();
    });
    await expect.poll(() => isPlaying(player)).toBe(false);
    await expect(player.locator('[data-toggle]')).toHaveAttribute('aria-label', /^Play /);
  });

  test('a clip plays to the end and resets', async ({ page }) => {
    const player = await firstPlayer(page);
    await player.locator('[data-toggle]').click();
    await expect.poll(() => isPlaying(player)).toBe(true);
    await player.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.dispatchEvent(new Event('ended'));
    });
    await expect(player.locator('[data-seek]')).toHaveValue('0');
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
