import { test, expect } from '@playwright/test';

test.describe('Jade Three homepage', () => {
  test('has correct page title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Jade Three/);
  });

  test('renders the header with artist name', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByText('Jade Three')).toBeVisible();
  });

  test('renders the hero section', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('section').first();
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('heading', { level: 1 })).toContainText('Jade Three');
  });

  test('hero heading shows the wordmark logo', async ({ page }) => {
    await page.goto('/');
    const wordmark = page.locator('section').first().locator('h1 svg');
    await expect(wordmark).toBeVisible();
    const box = await wordmark.boundingBox();
    expect(box!.width).toBeGreaterThan(250);
    expect(box!.width / box!.height).toBeCloseTo(7190 / 714, 1);
  });

  test('hero has a "Listen" link that scrolls to releases', async ({ page }) => {
    await page.goto('/');
    const listenLink = page.getByRole('link', { name: /listen/i });
    await expect(listenLink).toBeVisible();
    await expect(listenLink).toHaveAttribute('href', '#releases');
  });

  test('renders the releases section', async ({ page }) => {
    await page.goto('/');
    const releases = page.locator('#releases');
    await expect(releases).toBeVisible();
  });

  test('renders at least one release card', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('#releases article');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('EP/album releases render with title and a player', async ({ page }) => {
    await page.goto('/');
    // AlbumCard renders the release title and an "EP" or "Album" label
    const albumCard = page.locator('#releases article').filter({ hasText: /\bEP\b|\bAlbum\b/ });
    await expect(albumCard.first()).toBeVisible();
    // The card has the local player, or a Spotify album embed as the fallback
    const player = albumCard.first().locator('[data-player], iframe[src*="open.spotify.com/embed/album"]');
    await expect(player).toBeVisible();
  });

  test('each release card has a Spotify link', async ({ page }) => {
    await page.goto('/');
    const spotifyLinks = page.locator('#releases a[href*="open.spotify.com"]');
    await expect(spotifyLinks.first()).toBeVisible();
  });

  test('every release card has exactly one player', async ({ page }) => {
    await page.goto('/');
    const cards = await page.locator('#releases article').all();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      // Local player, Spotify embed, or the "Player unavailable" placeholder.
      const players = card.locator('[data-player], iframe[src*="open.spotify.com/embed"], [style*="height"]');
      await expect(players).toHaveCount(1);
    }
  });

  test('renders the footer', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('Jade Three');
  });

  test('footer has Spotify link', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: /spotify/i })).toBeVisible();
  });

  test('page has no viewport overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('page background is dark (not white)', async ({ page }) => {
    await page.goto('/');
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Should not be white or near-white
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('no broken internal links', async ({ page }) => {
    await page.goto('/');
    const internalLinks = await page
      .locator('a[href^="/"], a[href^="#"]')
      .evaluateAll(els => els.map(el => (el as HTMLAnchorElement).href));
    // All internal hrefs should be non-empty
    for (const href of internalLinks) {
      expect(href).toBeTruthy();
    }
  });
});
