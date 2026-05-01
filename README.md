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
| `clips.yaml` | Approved/sent Bluesky clips |
| `scripts/` | Data-fetching and posting scripts |

## Updating releases

Release data lives in `src/data/releases.json`. Scripts are available to sync data from each platform:

```bash
npm run fetch-releases      # sync from Spotify (requires .env with Spotify credentials)
```

After syncing, manually add `amazonMusicUrl` for any new entries, then commit the updated JSON.

## Tests

```bash
npm test                    # Playwright end-to-end tests
npm run test:scripts        # unit tests for post-clip.mjs
```

## Posting clips to Bluesky

`scripts/post-clip.mjs` picks a random approved, unsent clip from `clips.yaml` and posts it to Bluesky with a link card. A launchd job (`scripts/com.jade.jade3-to-bluesky.plist`) runs this automatically on Tue/Thu/Sat at 1:14 PM.

### Generating clips

`scripts/generate-clips.mjs` uses Claude to generate social media clips for each song from its markdown notes in `src/content/songs/`. Output is written to `clips.yaml`.

```bash
node scripts/generate-clips.mjs              # all songs
node scripts/generate-clips.mjs stinger      # one song by slug
```

Re-running skips songs that already have entries in `clips.yaml`. To regenerate a song, delete its entry first.

### 1. Get a Bluesky app password

1. Log into Bluesky
2. Go to **Settings → Privacy and Security → App Passwords**
3. Create a new app password and copy it

### 2. Set environment variables

```sh
export BLUESKY_HANDLE=yourhandle.bsky.social
export BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### 3. Mark clips for posting in `clips.yaml`

Each clip has two flags:

```yaml
- approved: false   # set to true to make eligible for posting
  sent: false       # updated automatically after posting — don't change by hand
  text: |
    Your post text here.

    https://jadethreemusic.com/releases/your-song
```

Set `approved: true` on any clips you want to post. Leave `sent` alone — the script flips it to `true` automatically after a successful post.

### 4. Preview before posting (dry run)

```sh
node scripts/post-clip.mjs --dry-run
```

Prints the clip that would be posted without sending anything.

### 5. Post for real

```sh
node scripts/post-clip.mjs
```

Picks one eligible clip at random, posts it to Bluesky with a link card, then marks it `sent: true` in `clips.yaml`. Commit the updated `clips.yaml` afterward to keep the record in sync.
