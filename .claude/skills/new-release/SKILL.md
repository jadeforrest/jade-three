# /new-release — Add a new release to the site

You are helping Jade Three add a new release to his music site. Work through the following steps in order. Be conversational — this should feel like a collaborative session, not a checklist.

---

## Step 1 — Sync releases

Run `node scripts/fetch-releases.js` to pull the latest data from iTunes into `src/data/releases.json`. Report what it outputs.

---

## Step 2 — Find the new release

Read `src/data/releases.json`. Then list all `releaseId` values from the frontmatter of every file in `src/content/songs/`. Find which releases in `releases.json` have no corresponding song page. Present these to the user and confirm which one to process (if there's only one obvious new one, confirm it rather than asking).

---

## Step 3 — Collect missing platform URLs

`scripts/fetch-releases.js` pulls from iTunes only, so it always writes `null` for every Spotify field — both release-level and track-level.

**Ask the user for only two things**, and only if they aren't already filled in:

1. The **Spotify album URL** for the release (`https://open.spotify.com/album/<albumId>`)
2. The **YouTube URL** (`youtubeUrl` for singles, `youtubePlaylistUrl` for EPs)

Ask for both in one message. Do **not** ask for track IDs — derive every one of them yourself from the album URL. The user rarely has them to hand, and a field nobody has to remember is a field nobody can forget.

### Derive the track IDs

The album's embed page lists every track URI in order:
```bash
curl -s -H "User-Agent: Mozilla/5.0" "https://open.spotify.com/embed/album/<albumId>" | grep -o '"uri":"spotify:track:[A-Za-z0-9]*"' | sort -u
```

For an EP, match the returned IDs to tracks by position — then confirm the mapping by checking each one's title in the verification step below, since `sort -u` does not preserve track order.

### Verify before writing

Check every ID — release and track — against the oEmbed endpoint. A valid one returns JSON including the title; a bad one returns an empty body:
```bash
curl -s "https://open.spotify.com/oembed?url=https://open.spotify.com/track/<trackId>"
```
Confirm the returned `"title"` matches the track you're about to assign it to. `https://open.spotify.com/embed/track/<badId>` returns HTTP 200 regardless and only renders "Page not found" inside the iframe, so a status-code check proves nothing.

### Then write them in

Edit `src/data/releases.json` and set, for the chosen release:
- Release level: `spotifyId` (the album ID), `spotifyUrl` (the album URL), and `youtubeUrl` / `youtubePlaylistUrl`
- **Track level, every track: `spotifyId` and `spotifyUrl` (the track URL, not the album URL)**

**The track-level `spotifyId` is the field that broke the Lickin release.** Until a release has local clips, the card players on the homepage and the song page embed the *track*, not the album, so a missing track `spotifyId` means no player. The card has no artwork of its own — the player *is* the visible body of the card — so a broken embed makes the release look like it never got added at all. Step 6b exists to catch this; don't rely on it.

Leave `amazonMusicUrl` as `null` unless the user volunteers it.

---

## Step 4 — Create the song page

Derive a URL-friendly slug from the release title: lowercase, spaces to hyphens, remove punctuation. Create `src/content/songs/<slug>.md`.

**For singles**, create one file with `trackNumber: 1`.

**For EPs**, create one file per track. Use the track titles and track numbers from `releases.json`. Ask the user if they want to handle all tracks in one session or one at a time.

Frontmatter template:
```yaml
---
releaseId: "<id from releases.json>"
title: "<track title>"
type: <single|ep>
trackNumber: <n>
releaseDate: "<YYYY-MM-DD>"
genres: []
themes: []
mood: []
bpm: null
key: ""
---
```

After the frontmatter, add the stub:
```markdown
# Song Q&A
```

---

## Step 5 — The interview

Conduct a casual, magazine-style interview. Ask questions one at a time (or in natural pairs where they flow together). Pick 5–7 questions that feel most interesting for this specific song — vary the selection each time. After each answer, write it into the file immediately under the appropriate `## Heading`.

**Always include at least two of these core questions:**
- What's the song about?
- Walk me through how this one started — what was the very first thing you had?

**Rotate freely from these — pick what fits the song and feels fresh:**
- Was there a moment during production when you knew this one was actually good? What tipped you off?
- What's a production choice on this track you're especially happy with — something deliberate that might not be obvious to the listener?
- Did any earlier versions of this go in a completely different direction? What killed them?
- What sounds or textures define this track for you, and how did you find them?
- What were you listening to obsessively while you were making this?
- If you had to describe the emotional territory of this track in two or three words, what would they be?
- Is there a moment in the arrangement you hid there specifically for the attentive listener?
- What did this track teach you — about production, about what you want to do more of?
- How does this one fit into the arc of your work — evolution, departure, or return to something?
- What would you do differently if you started it from scratch today?
- What's the title about — was it obvious from the start, or did it take a while to land on?
- If this song were a scene in a film, describe what's on screen.
- Any lyrics you're especially proud of? (answer "N/A — instrumental" if no lyrics)

**For EPs, also include at least one of these about the collection as a whole:**
- What made these tracks feel like they belonged together — was that intentional from the start or did you discover it?
- How did you decide on the running order?
- Is there an arc across the EP — does it take the listener somewhere specific?
- What does the EP title mean to you?
- Was there a track that almost made the cut but didn't?

Write every answer in Jade Three's first-person voice, casual and direct, exactly as he says it. Don't summarize or clean up his phrasing unnecessarily.

**After the interview is complete, reorder the sections in the file into a logical reading order before saving the final version.** Suggested order: What's the song about → How it started → Sounds/textures → Production choices/moments → Lyrics → What it taught → Arc/evolution. Questions not in this list can follow at the end. The goal is that the file reads well as a standalone piece, not in the order the questions happened to be asked.

---

## Step 6 — Generate and review clips

Once the interview is complete and saved, run:
```
node scripts/generate-clips.mjs <slug>
```

Show the user the newly generated clips from `clips.yaml` for this song. Ask if anything should be tweaked (they can ask you to edit the song page and regenerate). Then ask: **"Would you like to post one of these clips now?"**

---

## Step 6a — Add the preview clips

Ask for the path to the master and where the clip should start. Run this once per track, using the release's slug as the folder (for an EP, the `-ep` page's slug for every track):
```bash
node scripts/encode-media.mjs <slug> <track-number> <master> --start 1:05
```
It writes `src/assets/media/<slug>/<NN>.mp3` and, on first run, `cover.jpg` from the release artwork (pass `--cover <file>` to use a different image). Masters stay out of the repo.

A release uses the local player only once **every** track has a clip; until then it stays on Spotify. If the user has no master to hand, skip this step — the Spotify fallback is fine.

---

## Step 6b — Verify the release renders

Run `npm run build`. If the release has clips, the build fails on a misnamed or stray file. If it's on the Spotify fallback, confirm the embed points at a *track* ID and not an album ID:
```bash
grep -o "open.spotify.com/embed/[a-z]*/[A-Za-z0-9]*" dist/index.html | sort -u
```
Singles must appear as `embed/track/...`; only EPs/albums should appear as `embed/album/...`. Then start the dev server and take a screenshot of the release card — confirm the local player shows the cover and a Play button, or the Spotify player shows artwork and a Preview button, rather than an empty box.

---

## Step 7 — Retrospective

After everything is done, take a moment to reflect on how the session went. Identify 1–2 specific things that felt awkward, slow, or could work better. Suggest concrete improvements and ask Jade Three if he'd like to implement them.
