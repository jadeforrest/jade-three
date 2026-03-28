---
name: new-release
description: Full workflow for adding a new release to the site — syncs from iTunes, collects platform URLs, creates the song content page, conducts the Q&A interview, generates clips, and ends with a retrospective.
---

You are helping Jade Three add a new release to his music site. Work through the following steps in order. Be conversational — this should feel like a collaborative session, not a checklist.

---

## Step 1 — Sync releases

Run `node scripts/fetch-releases.js` to pull the latest data from iTunes into `src/data/releases.json`. Report what it outputs.

---

## Step 2 — Find the new release

Read `src/data/releases.json`. Then list all `releaseId` values from the frontmatter of every file in `src/content/songs/`. Find which releases in `releases.json` have no corresponding song page. Present these to the user and confirm which one to process (if there's only one obvious new one, confirm it rather than asking).

---

## Step 3 — Collect missing platform URLs

For the chosen release, check its entry in `releases.json`:
- For singles: check `spotifyUrl` and `youtubeUrl`
- For EPs: check `spotifyUrl` and `youtubePlaylistUrl`

For any that are `null` or missing, ask the user to provide them (ask for all missing ones at once, not one at a time). Once provided, edit `src/data/releases.json` to add those values to the correct release entry.

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
- Where did the idea come from?
- How did it come together in the studio/production?

**Rotate freely from these — pick what fits the song and feels fresh:**
- What was the very first thing you had — a beat, a melody, a sound, a vibe?
- Was there a turning point in production where the song clicked into place?
- What software, instruments, or plugins were central to the sound?
- Were there any happy accidents or unexpected discoveries along the way?
- Did any earlier versions get scrapped? What were they like?
- What feeling were you trying to chase with this one?
- Who or what were you listening to when you were making this?
- What's your favourite moment in the track?
- Is there anything in the arrangement that listeners might not notice on first listen?
- Any lyrics you're especially proud of? (skip or answer "N/A — instrumental" if no lyrics)
- If this song were a scene in a film, what would be happening?
- How does this one sit alongside your other releases — is it a departure, a continuation, something else?

Write every answer in Jade Three's first-person voice, casual and direct, exactly as he says it. Don't summarize or clean up his phrasing unnecessarily.

---

## Step 6 — Generate and review clips

Once the interview is complete and saved, run:
```
node scripts/generate-clips.mjs <slug>
```

Show the user the newly generated clips from `clips.yaml` for this song. Ask if anything should be tweaked (they can ask you to edit the song page and regenerate). Then ask: **"Would you like to post one of these clips now?"**

---

## Step 7 — Retrospective

After everything is done, take a moment to reflect on how the session went. Identify 1–2 specific things that felt awkward, slow, or could work better. Suggest concrete improvements and ask Jade Three if he'd like to implement them.
