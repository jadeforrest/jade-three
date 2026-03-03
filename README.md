# Jade Three

Music website for Jade Three — a chronological showcase of releases with Spotify embeds, platform links, and song notes.

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com). Deployed on Netlify at [jadethreemusic.com](https://jadethreemusic.com).

## Development

```bash
npm install
npm run dev       # dev server at localhost:4321
npm run build     # production build
npm run preview   # preview production build
```

## Key files

| Path | Purpose |
|------|---------|
| `src/data/releases.json` | All release data — platform links, track data |
| `src/content/songs/*.md` | Per-song notes and metadata |
| `src/content/artist/profile.md` | Artist bio/profile |
| `src/components/` | Astro UI components |
| `scripts/` | Data-fetching scripts |

## Updating releases

Release data lives in `src/data/releases.json`. Scripts are available to sync data from each platform:

```bash
npm run fetch-releases      # sync from Spotify (requires .env with Spotify credentials)
npm run fetch-apple-music   # fetch Apple Music URLs interactively
npm run fetch-youtube       # fetch YouTube URLs interactively
```

After syncing, manually add `amazonMusicUrl` for any new entries, then commit the updated JSON.

## Tests

```bash
npx playwright test
```
