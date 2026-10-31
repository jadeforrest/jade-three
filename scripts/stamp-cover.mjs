#!/usr/bin/env node
/**
 * stamp-cover.mjs
 * Resizes artwork for the site and stamps the gold E in the lower left, so
 * every cover carries the same mark at the same proportions.
 *
 * Usage:
 *   node scripts/stamp-cover.mjs <artwork> <output.jpg> [--stamp dark]
 *
 * The stamp is gold by default. Use the dark one on light artwork, where gold
 * doesn't read. Run it on clean artwork, not on an already-stamped cover. encode-media.mjs
 * calls this for every cover it writes. Requires ffmpeg.
 */

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const BRAND = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
const STAMPS = {
  gold: join(BRAND, 'jade-three-e-gold.png'),
  dark: join(BRAND, 'jade-three-e-dark.png'),
};
const MAX_WIDTH = 1400;
const STAMP_HEIGHT_RATIO = 0.07;
const MARGIN_RATIO = 0.04;

/** Sizes follow the output width, so a stamp looks the same on any artwork. */
export function stampLayout(width) {
  const outputWidth = Math.min(MAX_WIDTH, width);
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

export function stampArgs(input, output, width, stamp = 'gold') {
  const { outputWidth, stampHeight, margin } = stampLayout(width);
  const filter = [
    `[0:v]scale=${outputWidth}:-2[art]`,
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

function imageWidth(file) {
  const width = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file],
    { encoding: 'utf-8' },
  );
  return Number(width.trim());
}

export function stampCover(input, output, stamp = 'gold') {
  execFileSync('ffmpeg', stampArgs(input, output, imageWidth(input), stamp), { stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, flag, stamp] = process.argv.slice(2);
  if (!input || !output || (flag !== undefined && flag !== '--stamp')) {
    console.error('Usage: stamp-cover.mjs <artwork> <output.jpg> [--stamp dark]');
    process.exit(1);
  }
  stampCover(input, output, stamp);
  console.log(`Wrote ${output}`);
}
