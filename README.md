# Jade Three

Music website for Jade Three — a chronological showcase of releases with Spotify embeds and platform links.

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com). Deployed on Netlify.

## Development

```bash
npm install
npm run dev       # dev server at localhost:4321
npm run build     # production build
npm run preview   # preview production build
```

## Updating releases

Release data lives in `src/data/releases.json`. To sync new releases from Spotify:

```bash
npm run fetch-releases
```

Requires a `.env` file with Spotify credentials (see `.env.example`). After running, manually add `appleMusicUrl`, `amazonMusicUrl`, and `youtubeUrl` for any new entries, then commit the updated JSON.

## Tests

```bash
npx playwright test
```
