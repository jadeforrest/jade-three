#!/usr/bin/env node
/**
 * stamp-cover.mjs
 * Stamps the gold E in the lower left of artwork, so every cover carries the
 * same mark at the same proportions.
 *
 * Usage:
 *   node scripts/stamp-cover.mjs <artwork> <output.jpg> (--site | --distribution) [--stamp dark]
 *
 * You must say what the cover is for:
 *   --site          capped at 1400 px wide, for the website.
 *   --distribution  square, 1500-6000 px. Artwork keeps its own size, or is
 *                   scaled down to 6000; smaller or non-square artwork fails.
 *
 * The stamp is gold by default. Use the dark one on light artwork, where gold
 * doesn't read. Run it on clean artwork, not on an already-stamped cover.
 * encode-media.mjs calls this for every site cover it writes. Requires ffmpeg.
 */

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const BRAND = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
const STAMPS = {
  gold: join(BRAND, 'jade-three-e-gold.png'),
  dark: join(BRAND, 'jade-three-e-dark.png'),
};
export const TARGETS = {
  site: { minWidth: 1, maxWidth: 1400, square: false },
  distribution: { minWidth: 1500, maxWidth: 6000, square: true },
};
const STAMP_HEIGHT_RATIO = 0.07;
const MARGIN_RATIO = 0.04;

function targetSpec(target) {
  if (!Object.hasOwn(TARGETS, target)) throw new Error(`Unknown target: ${target} (use site or distribution)`);
  return TARGETS[target];
}

/** Throws when the artwork can't be made into a cover for this target. */
export function checkArtwork(width, height, target) {
  const { minWidth, square } = targetSpec(target);
  if (square && width !== height) throw new Error(`${target} artwork must be square, got ${width}x${height}`);
  if (width < minWidth) throw new Error(`${target} artwork must be at least ${minWidth} px wide, got ${width}`);
}

/** Sizes follow the output width, so a stamp looks the same on any artwork. */
export function stampLayout(width, target) {
  const outputWidth = Math.min(targetSpec(target).maxWidth, width);
  return {
    outputWidth,
    stampHeight: Math.round(outputWidth * STAMP_HEIGHT_RATIO),
    margin: Math.round(outputWidth * MARGIN_RATIO),
  };
}

export function stampFile(name) {
  if (!Object.hasOwn(STAMPS, name)) throw new Error(`Unknown stamp: ${name}`);
  return STAMPS[name];
}

export function stampArgs(input, output, width, { target, stamp = 'gold' }) {
  const { outputWidth, stampHeight, margin } = stampLayout(width, target);
  // Artwork already at size isn't scaled: scale's -2 would round an odd height to even.
  const filter = [
    outputWidth === width ? '[0:v]null[art]' : `[0:v]scale=${outputWidth}:-2[art]`,
    `[1:v]scale=-1:${stampHeight}:flags=lanczos[stamp]`,
    `[art][stamp]overlay=${margin}:main_h-overlay_h-${margin}`,
  ].join(';');
  return [
    '-y', '-loglevel', 'error',
    '-i', input, '-i', stampFile(stamp),
    '-filter_complex', filter,
    '-map_metadata', '-1',
    '-frames:v', '1', '-update', '1', '-q:v', '3',
    output,
  ];
}

function imageSize(file) {
  const size = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf-8' },
  );
  return size.trim().split(',').map(Number);
}

export function stampCover(input, output, { target, stamp = 'gold' }) {
  const [width, height] = imageSize(input);
  checkArtwork(width, height, target);
  execFileSync('ffmpeg', stampArgs(input, output, width, { target, stamp }), { stdio: 'inherit' });
}

/** Parses the CLI arguments, or returns null when they don't make sense. */
export function parseCli(argv) {
  const [input, output, ...flags] = argv;
  const options = { stamp: 'gold', targets: [] };
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--site' || flags[i] === '--distribution') options.targets.push(flags[i].slice(2));
    else if (flags[i] === '--stamp' && i + 1 < flags.length) options.stamp = flags[++i];
    else return null;
  }
  if (!input || !output || options.targets.length !== 1) return null;
  return { input, output, target: options.targets[0], stamp: options.stamp };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cli = parseCli(process.argv.slice(2));
  if (!cli) {
    console.error('Usage: stamp-cover.mjs <artwork> <output.jpg> (--site | --distribution) [--stamp dark]');
    process.exit(1);
  }
  try {
    stampCover(cli.input, cli.output, cli);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Wrote ${cli.output}`);
}
