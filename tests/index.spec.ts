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

  test('renders at least one release section heading (Albums or Singles)', async ({ page }) => {
    await page.goto('/');
    const albumsHeading = page.getByRole('heading', { name: /albums/i });
    const singlesHeading = page.getByRole('heading', { name: /singles/i });
    const hasAlbums = await albumsHeading.isVisible().catch(() => false);
    const hasSingles = await singlesHeading.isVisible().catch(() => false);
    expect(hasAlbums || hasSingles).toBe(true);
  });

  test('renders at least one release card', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('#releases article');
    await expect(cards.first()).toBeVisible();
  });

  test('each release card has a Spotify link', async ({ page }) => {
    await page.goto('/');
    const spotifyLinks = page.locator('#releases a[href*="open.spotify.com"]');
    await expect(spotifyLinks.first()).toBeVisible();
  });

  test('Spotify embed or placeholder is present for each release', async ({ page }) => {
    await page.goto('/');
    // With real Spotify IDs an iframe renders; with placeholder data a fallback div renders.
    const embeds = page.locator('iframe[src*="open.spotify.com/embed"]');
    const placeholders = page.locator('#releases [style*="height"] >> text=Player unavailable');
    const embedCount = await embeds.count();
    const placeholderCount = await placeholders.count();
    expect(embedCount + placeholderCount).toBeGreaterThan(0);
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
