#!/usr/bin/env node
/**
 * fetch-apple-music.js
 * Searches the iTunes Search API to find Apple Music URLs for all releases
 * that don't already have one, and writes them to src/data/releases.json.
 *
 * Usage:
 *   npm run fetch-apple-music
 *
 * No credentials required — iTunes Search API is public.
 * Requires Node 18+ (uses built-in fetch).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'src', 'data', 'releases.json');

const ARTIST_NAME = 'Jade Three';
// Small delay between requests to be polite to the API
const DELAY_MS = 300;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function searchAppleMusic(artistName, releaseTitle) {
  const query = encodeURIComponent(`${artistName} ${releaseTitle}`);
  const url = `https://itunes.apple.com/search?term=${query}&media=music&entity=album&limit=10&country=US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes API error: ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

function findBestMatch(results, releaseTitle) {
  const normalizedTitle = normalize(releaseTitle);

  // Prefer exact artist + title match
  for (const r of results) {
    const rTitle = normalize(r.collectionName ?? '');
    // iTunes appends " - Single" or " - EP" to collection names
    const rTitleClean = rTitle.replace(/single$/, '').replace(/ep$/, '').replace(/-$/, '');
    if (rTitleClean === normalizedTitle || rTitle === normalizedTitle) {
      return r.collectionViewUrl ?? null;
    }
  }

  // Looser: title starts with our title (handles suffixes like " - Single")
  for (const r of results) {
    const rTitle = normalize(r.collectionName ?? '');
    if (rTitle.startsWith(normalizedTitle)) {
      return r.collectionViewUrl ?? null;
    }
  }

  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  let updated = 0;
  let skipped = 0;
  let notFound = [];

  for (const release of data.releases) {
    if (release.appleMusicUrl) {
      console.log(`  ✓ ${release.title} — already set`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ? ${release.title} — searching...`);
    await sleep(DELAY_MS);

    try {
      const results = await searchAppleMusic(ARTIST_NAME, release.title);
      const url = findBestMatch(results, release.title);

      if (url) {
        release.appleMusicUrl = url;
        console.log(` found\n    ${url}`);
        updated++;
      } else {
        console.log(` not found`);
        notFound.push(release.title);
      }
    } catch (err) {
      console.log(` error: ${err.message}`);
      notFound.push(release.title);
    }
  }

  data.lastUpdated = new Date().toISOString().slice(0, 10);
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');

  console.log(`\nDone. Updated: ${updated}, already set: ${skipped}, not found: ${notFound.length}`);
  if (notFound.length > 0) {
    console.log('Not found (add manually):');
    for (const t of notFound) console.log(`  - ${t}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
