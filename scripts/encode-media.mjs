#!/usr/bin/env node
/**
 * encode-media.mjs
 * Cuts a preview clip from a master and writes it to src/assets/media/<slug>/,
 * along with cover.jpg. Masters stay out of the repo.
 *
 * Usage:
 *   node scripts/encode-media.mjs <slug> <track> <master> [--start 1:05] [--length 30] [--cover art.png]
 *
 * <slug> is any song page for the release, used as the folder name. For an EP,
 * use the same slug for every track (e.g. year-until-the-fall-ep).
 *
 * Without --cover, an existing cover.jpg is kept; otherwise the release artwork
 * is downloaded from Apple. Requires ffmpeg.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FADE_OUT_SECONDS = 2;
const COVER_SIZE = 1400;

/** Accepts seconds ("95", "12.5") or m:ss ("1:35"). */
export function parseTime(value) {
  const match = /^(?:(\d+):([0-5]\d)|(\d+(?:\.\d+)?))$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return match[3] !== undefined ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2]);
}

export function parseArgs(argv) {
  const [slug, track, master, ...flags] = argv;
  if (!slug || !master || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error('Usage: encode-media.mjs <slug> <track> <master> [--start 1:05] [--length 30] [--cover art.png]');
  }
  if (!/^[1-9]\d?$/.test(track)) throw new Error(`Invalid track number: ${track}`);

  const options = { slug, track: Number(track), master, start: 0, length: 30, cover: null };
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--start') options.start = parseTime(value);
    else if (flag === '--length') options.length = parseTime(value);
    else if (flag === '--cover') options.cover = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.length <= FADE_OUT_SECONDS) {
    throw new Error(`Length must be over ${FADE_OUT_SECONDS} seconds`);
  }
  return options;
}

export function clipArgs({ master, start, length }, output) {
  const filters = [
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'afade=t=in:d=0.5',
    `afade=t=out:st=${length - FADE_OUT_SECONDS}:d=${FADE_OUT_SECONDS}`,
  ].join(',');
  return [
    '-y', '-loglevel', 'error',
    '-ss', String(start), '-t', String(length), '-i', master,
    '-map', '0:a:0', '-map_metadata', '-1',
    '-af', filters,
    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k',
    output,
  ];
}

export function coverArgs(input, output) {
  return [
    '-y', '-loglevel', 'error', '-i', input,
    '-map_metadata', '-1',
    '-vf', `scale='min(${COVER_SIZE},iw)':-2`,
    '-frames:v', '1', '-update', '1', '-q:v', '3',
    output,
  ];
}

function ffmpeg(args) {
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

/** The frontmatter releaseId of a song page, looked up in releases.json. */
function findRelease(slug) {
  const page = join(ROOT, 'src/content/songs', `${slug}.md`);
  if (!existsSync(page)) throw new Error(`No song page: ${page}`);
  const releaseId = /^releaseId:\s*"(.+)"/m.exec(readFileSync(page, 'utf-8'))?.[1];
  const { releases } = JSON.parse(readFileSync(join(ROOT, 'src/data/releases.json'), 'utf-8'));
  const release = releases.find((r) => r.id === releaseId);
  if (!release) throw new Error(`No release for ${slug}: ${releaseId}`);
  return release;
}

async function downloadArtwork(release, output) {
  const url = release.artworkUrl.replace('600x600bb', '3000x3000bb');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Artwork download failed: ${res.status} ${url}`);
  const tmp = mkdtempSync(join(tmpdir(), 'encode-media-'));
  try {
    const download = join(tmp, 'artwork.jpg');
    writeFileSync(download, Buffer.from(await res.arrayBuffer()));
    ffmpeg(coverArgs(download, output));
  } finally {
    rmSync(tmp, { recursive: true });
  }
}

async function writeCover(coverSource, release, output) {
  if (coverSource) {
    ffmpeg(coverArgs(coverSource, output));
  } else if (!existsSync(output)) {
    await downloadArtwork(release, output);
  }
  console.log(`Cover: ${output}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const release = findRelease(options.slug);
  if (!release.tracks.some((t) => t.trackNumber === options.track)) {
    throw new Error(`"${release.title}" has no track ${options.track}`);
  }

  const folder = join(ROOT, 'src/assets/media', options.slug);
  mkdirSync(folder, { recursive: true });

  const clip = join(folder, `${String(options.track).padStart(2, '0')}.mp3`);
  ffmpeg(clipArgs(options, clip));
  console.log(`Wrote ${clip}`);

  await writeCover(options.cover, release, join(folder, 'cover.jpg'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
