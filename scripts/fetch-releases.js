#!/usr/bin/env node
/**
 * fetch-releases.js
 * Fetches all releases for Jade Three from the iTunes Search API and writes
 * them to src/data/releases.json, preserving any existing manually-added data
 * (Spotify URLs, YouTube links, Amazon Music URLs, etc.).
 *
 * Usage:
 *   npm run fetch-releases
 *
 * No credentials required — iTunes Search API is public.
 * Requires Node 18+ (uses built-in fetch).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_PATH = join(ROOT, 'src', 'data', 'releases.json');

const ARTIST_NAME = 'Jade Three';
const DELAY_MS = 300;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// iTunes API helpers
// ---------------------------------------------------------------------------
async function itunesGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes API error: ${res.status} ${url}`);
  return res.json();
}

async function getArtistId() {
  const query = encodeURIComponent(ARTIST_NAME);
  const data = await itunesGet(
    `https://itunes.apple.com/search?term=${query}&media=music&entity=musicArtist&limit=10&country=US`
  );
  const artist = data.results?.find(
    r => r.wrapperType === 'artist' && r.artistName?.toLowerCase() === ARTIST_NAME.toLowerCase()
  );
  if (!artist) throw new Error(`Artist "${ARTIST_NAME}" not found on iTunes`);
  return artist.artistId;
}

async function getArtistAlbums(artistId) {
  const data = await itunesGet(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200&country=US`
  );
  return data.results?.filter(r => r.wrapperType === 'collection') ?? [];
}

async function getAlbumTracks(collectionId) {
  const data = await itunesGet(
    `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&country=US`
  );
  return data.results?.filter(r => r.wrapperType === 'track') ?? [];
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------
function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** iTunes returns artworkUrl100 — swap in a larger size. */
function largeArtworkUrl(url) {
  return url?.replace('100x100bb', '600x600bb') ?? '';
}

function smallArtworkUrl(url) {
  return url?.replace('100x100bb', '64x64bb') ?? '';
}

/**
 * Normalize a title for fuzzy matching: lowercase, strip iTunes suffixes
 * ("- Single", "- EP"), remove all non-alphanumeric characters.
 */
function normalizeTitle(str) {
  return (str ?? '')
    .toLowerCase()
    .replace(/\s*[-–]\s*(single|ep)$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Strip " - Single" / " - EP" suffix that iTunes appends to collection names. */
function cleanTitle(collectionName) {
  return collectionName.replace(/\s*[-–]\s*(Single|EP)$/i, '').trim();
}

function inferType(collectionName, trackCount) {
  if (/\bEP\b/i.test(collectionName)) return 'ep';
  if (trackCount === 1) return 'single';
  if (trackCount <= 6) return 'ep';
  return 'album';
}

// ---------------------------------------------------------------------------
// Load existing data to preserve manually-added content
// ---------------------------------------------------------------------------
function loadExisting() {
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  } catch {
    return { releases: [] };
  }
}

function findExistingRelease(existing, collectionName) {
  const norm = normalizeTitle(collectionName);
  return existing.releases?.find(r => normalizeTitle(r.title) === norm) ?? null;
}

function findExistingTrack(existingRelease, trackName) {
  const norm = normalizeTitle(trackName);
  return existingRelease?.tracks?.find(t => normalizeTitle(t.title) === norm) ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Looking up artist "${ARTIST_NAME}" on iTunes...`);
  const artistId = await getArtistId();
  console.log(`Found artist ID: ${artistId}`);

  console.log('Fetching releases...');
  const albums = await getArtistAlbums(artistId);
  console.log(`Found ${albums.length} releases. Fetching track data...`);

  const existing = loadExisting();
  const releases = [];

  for (const album of albums) {
    process.stdout.write(`  Processing "${album.collectionName}"...`);
    await sleep(DELAY_MS);

    let trackItems = [];
    try {
      trackItems = await getAlbumTracks(album.collectionId);
    } catch (err) {
      console.warn(`\n    Warning: could not fetch tracks (${err.message}). Continuing without track list.`);
    }

    const existingRelease = findExistingRelease(existing, album.collectionName);
    const trackCount = trackItems.length || album.trackCount;
    const type = existingRelease?.type ?? inferType(album.collectionName, trackCount);
    const id = existingRelease?.id ?? `${type}-${album.collectionId}`;
    const title = existingRelease?.title ?? cleanTitle(album.collectionName);

    const tracks = trackItems.map(track => {
      const existingTrack = findExistingTrack(existingRelease, track.trackName);
      return {
        trackNumber: track.trackNumber,
        title: existingTrack?.title ?? track.trackName,
        spotifyId: existingTrack?.spotifyId ?? null,
        spotifyUrl: existingTrack?.spotifyUrl ?? null,
        appleMusicUrl: track.trackViewUrl ?? existingTrack?.appleMusicUrl ?? null,
        amazonMusicUrl: existingTrack?.amazonMusicUrl ?? null,
        youtubeUrl: existingTrack?.youtubeUrl ?? null,
        durationMs: track.trackTimeMillis ?? existingTrack?.durationMs ?? 0,
        durationFormatted: formatDuration(track.trackTimeMillis ?? existingTrack?.durationMs ?? 0),
        isExplicit: track.trackExplicitness === 'explicit',
      };
    });

    releases.push({
      id,
      type,
      title,
      releaseDate: album.releaseDate?.slice(0, 10) ?? existingRelease?.releaseDate ?? '',
      year: parseInt(album.releaseDate?.slice(0, 4) ?? existingRelease?.year ?? '0', 10),
      spotifyId: existingRelease?.spotifyId ?? null,
      spotifyUrl: existingRelease?.spotifyUrl ?? null,
      appleMusicUrl: album.collectionViewUrl ?? existingRelease?.appleMusicUrl ?? null,
      amazonMusicUrl: existingRelease?.amazonMusicUrl ?? null,
      youtubePlaylistUrl: existingRelease?.youtubePlaylistUrl ?? null,
      youtubeUrl: existingRelease?.youtubeUrl ?? null,
      artworkUrl: largeArtworkUrl(album.artworkUrl100),
      artworkUrlSmall: smallArtworkUrl(album.artworkUrl100),
      totalTracks: trackCount,
      tracks,
    });

    console.log(' done');
  }

  // Sort newest first
  releases.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    artistName: 'Jade Three',
    releases,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${releases.length} releases to ${OUTPUT_PATH}`);
  console.log('\nNext steps:');
  console.log('  • Add spotifyId, spotifyUrl, amazonMusicUrl, youtubeUrl to any new entries');
  console.log('  • git add src/data/releases.json && git commit -m "update releases"');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
