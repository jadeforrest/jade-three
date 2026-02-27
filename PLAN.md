# Jade Three Site Plan

## Context

The site has a solid visual foundation (dark theme, gold accents, responsive layout, Spotify embeds) but is not yet in a shippable state. Data gaps and missing configuration prevent it from being a fully working artist homepage. The goal is to ship a working, focused site first, then iterate toward a full artist presence.

The long-term vision: music discovery hub + full artist homepage — bio, contact, music — serving fans, bookers, and press.

---

## Phase 1 — Fix the current site (Spotify-only, working state)

Goal: Every release shows correct artwork, a working Spotify embed, and real track data.

- [ ] **1a.** Make sure we have all the releases — including the EP *Year Until the Fall* and any other missing releases
- [ ] **1b.** Fix missing artwork for "Obey Early" and "Eh Ville" (empty `artworkUrl` / `artworkUrlSmall` in `releases.json`)
- [ ] **1c.** Fix track durations and track-level Spotify IDs — 7/8 releases have `durationMs: 0`; track IDs are duplicates of album IDs. Root cause: Spotify API 403 errors (dev-mode quota). Resolve API access and re-run `npm run fetch-releases`.
- [ ] **1d.** Make Spotify embeds more visually prominent — currently blends in; consider increased height or clearer labeling
- [ ] **1e.** Verify Spotify-only platform links look intentional — other platforms conditionally hidden (correct), but check single-icon display doesn't look broken
- [ ] **1f.** Update Playwright tests to cover any new releases and verify no regressions

---

## Phase 2 — DNS + Hosting

- [ ] **2a.** Confirm Netlify deploy is clean (build command: `npm run build`, publish: `dist`, Node 20)
- [ ] **2b.** Choose and register custom domain
- [ ] **2c.** Configure DNS (A/CNAME to Netlify), add domain in Netlify UI
- [ ] **2d.** Update `site` in `astro.config.mjs` to real domain
- [ ] **2e.** Verify HTTPS/SSL certificate

---

## Phase 3 — Multi-platform links

Once live on Spotify:

- [ ] Manually populate `appleMusicUrl` for all releases in `releases.json`
- [ ] Manually populate `amazonMusicUrl` for all releases
- [ ] Manually populate `youtubeUrl` / `youtubePlaylistUrl` for all releases
- [ ] Populate per-track platform URLs where relevant

---

## Phase 4 — Full artist homepage

- [ ] **About / bio section** — artist story on the homepage
- [ ] **Contact / booking** — simple contact form or email link
- [ ] **Press / media kit** — downloadable press kit, press quotes
- [ ] **Mailing list / email signup** — fan email capture (e.g. Mailchimp)
- [ ] **Videos section** — embedded music videos (YouTube)
- [ ] **SEO improvements** — sitemap, structured data, per-release meta descriptions

---

## Key Files

| File | Purpose |
|------|---------|
| `src/data/releases.json` | All release data — primary place to fix data gaps |
| `src/components/SpotifyEmbed.astro` | Embed iframe + fallback |
| `src/components/SingleCard.astro` | Single release card |
| `src/components/AlbumCard.astro` | Album card with tracklist |
| `src/components/PlatformLinks.astro` | Platform icon links |
| `src/components/TrackRow.astro` | Individual track row |
| `scripts/fetch-releases.js` | Spotify API sync script |
| `astro.config.mjs` | Site URL config |
| `netlify.toml` | Deployment + CSP headers |
