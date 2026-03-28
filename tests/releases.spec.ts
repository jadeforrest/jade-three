import { test, expect } from '@playwright/test';

test.describe('Fall in Love release', () => {
  test('appears as a card on the homepage', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('#releases article').filter({ hasText: 'Fall in Love' });
    await expect(card).toBeVisible();
  });

  test('release page renders with title and Q&A content', async ({ page }) => {
    await page.goto('/releases/fall-in-love');
    await expect(page).toHaveTitle(/Fall in Love/i);
    await expect(page.getByRole('heading', { name: /Fall in Love/i }).first()).toBeVisible();
  });

  test('release page has platform links', async ({ page }) => {
    await page.goto('/releases/fall-in-love');
    const spotifyLink = page.locator('a[href*="spotify.com"]').first();
    await expect(spotifyLink).toBeVisible();
  });

  test('release page has a Spotify embed', async ({ page }) => {
    await page.goto('/releases/fall-in-love');
    const embed = page.locator('iframe[src*="open.spotify.com/embed"]');
    await expect(embed).toBeVisible();
  });
});
