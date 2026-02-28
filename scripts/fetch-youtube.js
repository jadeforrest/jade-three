#!/usr/bin/env node
/**
 * fetch-youtube.js
 * Searches the YouTube Data API v3 to find YouTube URLs for all releases
 * that don't already have one, and writes them to src/data/releases.json.
 *
 * Usage:
 *   1. Add YOUTUBE_API_KEY to your .env file.
 *      Get a key at https://console.cloud.google.com/ — enable "YouTube Data API v3".
 *   2. npm run fetch-youtube
 *
 * For singles: populates youtubeUrl with the best matching video.
 * For EPs/albums: populates youtubeUrl with a video and youtubePlaylistUrl with a playlist.
 *
 * Each found URL is shown for manual verification before being saved.
 * At the prompt: y = accept, n = skip, or paste a correct URL to use that instead.
 *
 * Requires Node 18+ (uses built-in fetch).
 */

import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'src', 'data', 'releases.json');

const ARTIST_NAME = 'Jade Three';
const DELAY_MS = 300;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));

// ---------------------------------------------------------------------------
// Load YOUTUBE_API_KEY from .env
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = join(ROOT, '.env');
  try {
    const raw = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return vars;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// YouTube API helpers
// ---------------------------------------------------------------------------
async function searchYouTube(apiKey, query, type = 'video', maxResults = 10) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type,
    maxResults: String(maxResults),
    key: apiKey,
  });
  const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.items ?? [];
}

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function channelMatches(snippet) {
  return snippet.channelTitle?.toLowerCase().includes('jade') ||
         snippet.channelTitle?.toLowerCase().includes('jade three');
}

function findBestVideo(items, releaseTitle) {
  const normTitle = normalize(releaseTitle);

  // First pass: from Jade Three channel with matching title
  for (const item of items) {
    if (!channelMatches(item.snippet)) continue;
    const vidTitle = normalize(item.snippet.title ?? '');
    if (vidTitle.includes(normTitle) || normTitle.includes(vidTitle.slice(0, 6))) {
      return `https://www.youtube.com/watch?v=${item.id.videoId}`;
    }
  }

  // Second pass: any result from Jade Three channel
  for (const item of items) {
    if (channelMatches(item.snippet)) {
      return `https://www.youtube.com/watch?v=${item.id.videoId}`;
    }
  }

  return null;
}

function findBestPlaylist(items, releaseTitle) {
  const normTitle = normalize(releaseTitle);

  for (const item of items) {
    if (!channelMatches(item.snippet)) continue;
    const plTitle = normalize(item.snippet.title ?? '');
    if (plTitle.includes(normTitle) || normTitle.includes(plTitle.slice(0, 6))) {
      return `https://www.youtube.com/playlist?list=${item.id.playlistId}`;
    }
  }

  // Any playlist from the channel
  for (const item of items) {
    if (channelMatches(item.snippet)) {
      return `https://www.youtube.com/playlist?list=${item.id.playlistId}`;
    }
  }

  return null;
}

/**
 * Prompts the user to accept a URL, reject it, or supply a replacement.
 * Returns the URL to use, or null to skip.
 */
async function confirm(url) {
  const answer = await ask(`    ${url}\n    [y] accept  [n] skip  [or paste correct URL]: `);
  const trimmed = answer.trim();
  if (trimmed.toLowerCase() === 'y') return url;
  if (trimmed.toLowerCase() === 'n' || trimmed === '') return null;
  // Treat anything else as a replacement URL
  return trimmed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const env = loadEnv();
  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('Error: YOUTUBE_API_KEY not found in .env');
    console.error('Get a key at https://console.cloud.google.com/ and enable YouTube Data API v3.');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  let updatedVideo = 0;
  let updatedPlaylist = 0;
  let skipped = 0;
  const notFound = [];

  for (const release of data.releases) {
    const needsVideo = !release.youtubeUrl;
    const needsPlaylist = !release.youtubePlaylistUrl && release.type !== 'single';

    if (!needsVideo && !needsPlaylist) {
      console.log(`  ✓ ${release.title} — already set`);
      skipped++;
      continue;
    }

    const query = `${ARTIST_NAME} ${release.title}`;

    // Search for video
    if (needsVideo) {
      process.stdout.write(`  ? ${release.title} — searching for video...`);
      await sleep(DELAY_MS);
      try {
        const items = await searchYouTube(apiKey, query, 'video');
        const candidate = findBestVideo(items, release.title);
        if (candidate) {
          console.log(` found`);
          const chosen = await confirm(candidate);
          if (chosen) {
            release.youtubeUrl = chosen;
            updatedVideo++;
          } else {
            console.log(`    Skipped — add manually`);
            notFound.push(`${release.title} (video)`);
          }
        } else {
          console.log(` not found — add manually`);
          notFound.push(`${release.title} (video)`);
        }
      } catch (err) {
        console.log(` error: ${err.message}`);
        notFound.push(`${release.title} (video)`);
      }
    }

    // Search for playlist (EPs and albums only)
    if (needsPlaylist) {
      process.stdout.write(`  ? ${release.title} — searching for playlist...`);
      await sleep(DELAY_MS);
      try {
        const items = await searchYouTube(apiKey, query, 'playlist');
        const candidate = findBestPlaylist(items, release.title);
        if (candidate) {
          console.log(` found`);
          const chosen = await confirm(candidate);
          if (chosen) {
            release.youtubePlaylistUrl = chosen;
            updatedPlaylist++;
          } else {
            console.log(`    Skipped — add manually`);
            notFound.push(`${release.title} (playlist)`);
          }
        } else {
          console.log(` not found — add manually`);
          notFound.push(`${release.title} (playlist)`);
        }
      } catch (err) {
        console.log(` error: ${err.message}`);
        notFound.push(`${release.title} (playlist)`);
      }
    }
  }

  rl.close();

  data.lastUpdated = new Date().toISOString().slice(0, 10);
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');

  console.log(`\nDone. Videos: ${updatedVideo}, playlists: ${updatedPlaylist}, already set: ${skipped}, not found: ${notFound.length}`);
  if (notFound.length > 0) {
    console.log('Not found / rejected (add manually):');
    for (const t of notFound) console.log(`  - ${t}`);
  }
}

main().catch(err => {
  rl.close();
  console.error(err);
  process.exit(1);
});
