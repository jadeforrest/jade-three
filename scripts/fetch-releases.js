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
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { isReleased, siteToday } from '../src/lib/release-dates.js';

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

async function getArtistId(get) {
  const query = encodeURIComponent(ARTIST_NAME);
  const data = await get(
    `https://itunes.apple.com/search?term=${query}&media=music&entity=musicArtist&limit=10&country=US`
  );
  const artist = data.results?.find(
    r => r.wrapperType === 'artist' && r.artistName?.toLowerCase() === ARTIST_NAME.toLowerCase()
  );
  if (!artist) throw new Error(`Artist "${ARTIST_NAME}" not found on iTunes`);
  return artist.artistId;
}

async function getArtistAlbums(get, artistId) {
  const data = await get(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200&country=US`
  );
  return data.results?.filter(r => r.wrapperType === 'collection') ?? [];
}

async function getAlbumTracks(get, collectionId) {
  const data = await get(
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
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')).releases ?? [];
  } catch {
    return [];
  }
}

function findExistingRelease(existing, collectionName) {
  const norm = normalizeTitle(collectionName);
  return existing.find(r => normalizeTitle(r.title) === norm) ?? null;
}

/**
 * An upcoming release is added to releases.json by hand before iTunes lists
 * it. Keep those, so a sync before release day doesn't delete them.
 */
export function keepUnlistedUpcoming(fetched, existing, today) {
  const listed = new Set(fetched.map(r => normalizeTitle(r.title)));
  return existing.filter(r => !isReleased(r.releaseDate, today) && !listed.has(normalizeTitle(r.title)));
}

/** The Apple album id at the end of an Apple Music album URL. */
function appleAlbumId(url) {
  return url?.match(/\/(\d+)(?:\?|$)/)?.[1] ?? null;
}

/**
 * iTunes can list two albums that map to the same site id (e.g. a re-issue
 * whose title differs only in capitalization). Keep one release per id: the
 * one whose Apple album matches the existing entry, else the first seen.
 */
export function dedupeReleases(releases, existing, warn = console.warn) {
  const existingAlbum = new Map(existing.map(r => [r.id, appleAlbumId(r.appleMusicUrl)]));
  const isExisting = r => appleAlbumId(r.appleMusicUrl) === existingAlbum.get(r.id);
  const kept = new Map();
  for (const r of [...releases.filter(isExisting), ...releases.filter(r => !isExisting(r))]) {
    if (kept.has(r.id)) {
      warn(`Warning: skipping duplicate of "${r.id}" from ${r.appleMusicUrl}`);
    } else {
      kept.set(r.id, r);
    }
  }
  return releases.filter(r => kept.get(r.id) === r);
}

function findExistingTrack(existingRelease, trackName) {
  const norm = normalizeTitle(trackName);
  return existingRelease?.tracks?.find(t => normalizeTitle(t.title) === norm) ?? null;
}

/** The first value that is neither null nor undefined, else the last one (a `??` chain). */
const firstSet = (...values) => values.find(v => v !== undefined && v !== null) ?? values.at(-1);

/** A hand-filled field from an existing entry, or null. */
const handFilled = (existing, key) => firstSet(existing?.[key], null);

/** One track entry: iTunes data, with hand-filled links kept from the existing track. */
export function buildTrack(track, existingTrack) {
  const durationMs = firstSet(track.trackTimeMillis, existingTrack?.durationMs, 0);
  return {
    trackNumber: track.trackNumber,
    title: firstSet(existingTrack?.title, track.trackName),
    spotifyId: handFilled(existingTrack, 'spotifyId'),
    spotifyUrl: handFilled(existingTrack, 'spotifyUrl'),
    appleMusicUrl: firstSet(track.trackViewUrl, existingTrack?.appleMusicUrl, null),
    amazonMusicUrl: handFilled(existingTrack, 'amazonMusicUrl'),
    youtubeUrl: handFilled(existingTrack, 'youtubeUrl'),
    durationMs,
    durationFormatted: formatDuration(durationMs),
    isExplicit: track.trackExplicitness === 'explicit',
  };
}

/**
 * One release entry for an iTunes album. The existing entry's id, type, title
 * and hand-filled links win; iTunes supplies dates, artwork and tracks.
 */
export function buildRelease(album, trackItems, existingRelease) {
  const trackCount = trackItems.length || album.trackCount;
  const type = firstSet(existingRelease?.type, inferType(album.collectionName, trackCount));
  return {
    id: firstSet(existingRelease?.id, `${type}-${album.collectionId}`),
    type,
    title: firstSet(existingRelease?.title, cleanTitle(album.collectionName)),
    releaseDate: firstSet(album.releaseDate?.slice(0, 10), existingRelease?.releaseDate, ''),
    year: parseInt(firstSet(album.releaseDate?.slice(0, 4), existingRelease?.year, '0'), 10),
    spotifyId: handFilled(existingRelease, 'spotifyId'),
    spotifyUrl: handFilled(existingRelease, 'spotifyUrl'),
    appleMusicUrl: firstSet(album.collectionViewUrl, existingRelease?.appleMusicUrl, null),
    amazonMusicUrl: handFilled(existingRelease, 'amazonMusicUrl'),
    youtubePlaylistUrl: handFilled(existingRelease, 'youtubePlaylistUrl'),
    youtubeUrl: handFilled(existingRelease, 'youtubeUrl'),
    artworkUrl: largeArtworkUrl(album.artworkUrl100),
    artworkUrlSmall: smallArtworkUrl(album.artworkUrl100),
    totalTracks: trackCount,
    tracks: trackItems.map(track => buildTrack(track, findExistingTrack(existingRelease, track.trackName))),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
/** Tracks for one album, or none (with a warning) if iTunes fails. */
async function tracksOrNone(get, album, out) {
  try {
    return await getAlbumTracks(get, album.collectionId);
  } catch (err) {
    out.warn(`\n    Warning: could not fetch tracks (${err.message}). Continuing without track list.`);
    return [];
  }
}

/**
 * Fetch every Jade Three album from iTunes and merge it with the existing
 * releases: one release per id, hand-added upcoming releases kept, newest first.
 * `get` fetches and parses an iTunes URL; `pause` spaces out the requests.
 */
export async function syncReleases({ get, existing, today, pause = sleep, out = console }) {
  out.log(`Looking up artist "${ARTIST_NAME}" on iTunes...`);
  const artistId = await getArtistId(get);
  out.log(`Found artist ID: ${artistId}`);

  out.log('Fetching releases...');
  const albums = await getArtistAlbums(get, artistId);
  out.log(`Found ${albums.length} releases. Fetching track data...`);

  const fetched = [];
  for (const album of albums) {
    out.log(`  Processing "${album.collectionName}"...`);
    await pause(DELAY_MS);
    const trackItems = await tracksOrNone(get, album, out);
    fetched.push(buildRelease(album, trackItems, findExistingRelease(existing, album.collectionName)));
  }

  const releases = dedupeReleases(fetched, existing, out.warn);
  releases.push(...keepUnlistedUpcoming(releases, existing, today));
  return releases.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
}

async function main() {
  const releases = await syncReleases({ get: itunesGet, existing: loadExisting(), today: siteToday() });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
