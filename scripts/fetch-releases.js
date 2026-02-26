#!/usr/bin/env node
/**
 * fetch-releases.js
 * Fetches all releases for Jade Three from the Spotify API and writes
 * them to src/data/releases.json.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in your Spotify credentials.
 *   2. npm run fetch-releases
 *   3. Manually add appleMusicUrl, amazonMusicUrl, youtubeUrl to new entries.
 *   4. Commit and push.
 *
 * Requires Node 18+ (uses built-in fetch).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_PATH = join(ROOT, 'src', 'data', 'releases.json');

const ARTIST_ID = '2T04y62jXdLsznulD3sT4D';
const MARKET = 'US';

// ---------------------------------------------------------------------------
// Load credentials from .env (no dotenv dependency needed)
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const envText = readFileSync(join(ROOT, '.env'), 'utf-8');
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — rely on environment variables already set
  }
}

// ---------------------------------------------------------------------------
// Spotify API helpers
// ---------------------------------------------------------------------------
async function getAccessToken(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.access_token;
}

async function spotifyGet(token, path) {
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify API error: ${res.status} ${url}`);
  return res.json();
}

/** Fetch all pages of an endpoint that returns a Paging object. */
async function fetchAllPages(token, initialUrl) {
  const items = [];
  let url = initialUrl;
  while (url) {
    const data = await spotifyGet(token, url);
    items.push(...data.items);
    url = data.next;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Data formatting helpers
// ---------------------------------------------------------------------------
function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function bestArtworkUrl(images, minWidth = 600) {
  if (!images || images.length === 0) return '';
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (sorted.find(img => (img.width ?? 0) >= minWidth) ?? sorted[0]).url;
}

function smallArtworkUrl(images) {
  if (!images || images.length === 0) return '';
  const sorted = [...images].sort((a, b) => (a.width ?? 9999) - (b.width ?? 9999));
  return sorted[0].url;
}

// ---------------------------------------------------------------------------
// Load existing releases to preserve manually-added URLs
// ---------------------------------------------------------------------------
function loadExisting() {
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  } catch {
    return { releases: [] };
  }
}

function preserveManualUrls(existing, spotifyId) {
  const found = existing.releases?.find(r => r.spotifyId === spotifyId);
  if (!found) return { appleMusicUrl: null, amazonMusicUrl: null, youtubePlaylistUrl: null, youtubeUrl: null };
  return {
    appleMusicUrl: found.appleMusicUrl ?? null,
    amazonMusicUrl: found.amazonMusicUrl ?? null,
    youtubePlaylistUrl: found.youtubePlaylistUrl ?? null,
    youtubeUrl: found.youtubeUrl ?? null,
  };
}

function preserveTrackManualUrls(existing, spotifyId, trackId) {
  const release = existing.releases?.find(r => r.spotifyId === spotifyId);
  const track = release?.tracks?.find(t => t.spotifyId === trackId);
  if (!track) return { appleMusicUrl: null, amazonMusicUrl: null, youtubeUrl: null };
  return {
    appleMusicUrl: track.appleMusicUrl ?? null,
    amazonMusicUrl: track.amazonMusicUrl ?? null,
    youtubeUrl: track.youtubeUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnv();

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Error: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  console.log('Authenticating with Spotify...');
  const token = await getAccessToken(clientId, clientSecret);

  console.log(`Fetching releases for artist ${ARTIST_ID}...`);
  const albumObjects = await fetchAllPages(
    token,
    `/v1/artists/${ARTIST_ID}/albums?include_groups=album,single&market=${MARKET}&limit=50`
  );

  console.log(`Found ${albumObjects.length} releases. Fetching track data...`);

  const existing = loadExisting();
  const releases = [];

  for (const album of albumObjects) {
    process.stdout.write(`  Fetching tracks for "${album.name}"...`);

    // Fetch full album details (includes tracks + images)
    const fullAlbum = await spotifyGet(token, `/v1/albums/${album.id}?market=${MARKET}`);
    const trackItems = fullAlbum.tracks?.items ?? [];

    // Fetch remaining pages of tracks if any
    let nextTracksUrl = fullAlbum.tracks?.next;
    while (nextTracksUrl) {
      const page = await spotifyGet(token, nextTracksUrl);
      trackItems.push(...page.items);
      nextTracksUrl = page.next;
    }

    const manual = preserveManualUrls(existing, album.id);
    const releaseType = album.album_type === 'album' ? 'album' : 'single';

    const tracks = trackItems.map(track => {
      const trackManual = preserveTrackManualUrls(existing, album.id, track.id);
      return {
        trackNumber: track.track_number,
        title: track.name,
        spotifyId: track.id,
        spotifyUrl: track.external_urls?.spotify ?? '',
        appleMusicUrl: trackManual.appleMusicUrl,
        amazonMusicUrl: trackManual.amazonMusicUrl,
        youtubeUrl: trackManual.youtubeUrl,
        durationMs: track.duration_ms ?? 0,
        durationFormatted: formatDuration(track.duration_ms ?? 0),
        isExplicit: track.explicit ?? false,
      };
    });

    releases.push({
      id: `${releaseType}-${album.id}`,
      type: releaseType,
      title: album.name,
      releaseDate: album.release_date,
      year: parseInt(album.release_date.slice(0, 4), 10),
      spotifyId: album.id,
      spotifyUrl: album.external_urls?.spotify ?? '',
      appleMusicUrl: manual.appleMusicUrl,
      amazonMusicUrl: manual.amazonMusicUrl,
      youtubePlaylistUrl: manual.youtubePlaylistUrl,
      youtubeUrl: manual.youtubeUrl,
      artworkUrl: bestArtworkUrl(fullAlbum.images),
      artworkUrlSmall: smallArtworkUrl(fullAlbum.images),
      totalTracks: fullAlbum.total_tracks ?? trackItems.length,
      tracks,
    });

    console.log(' done');
  }

  // Sort newest first
  releases.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    artistName: 'Jade Three',
    spotifyArtistId: ARTIST_ID,
    releases,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${releases.length} releases to ${OUTPUT_PATH}`);
  console.log('\nNext steps:');
  console.log('  • Add appleMusicUrl, amazonMusicUrl, youtubeUrl to any new entries');
  console.log('  • git add src/data/releases.json && git commit -m "update releases"');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
