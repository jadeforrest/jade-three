/**
 * Unit + property tests for scripts/stamp-cover.mjs
 * Run with: node --test tests/stamp-cover.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { stampArgs, stampCover, stampLayout } from '../scripts/stamp-cover.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = join(REPO, 'brand/jade-three-e-gold.png');

test('stampLayout scales from the output width, capped at 1400', () => {
  assert.deepEqual(stampLayout(3000), { outputWidth: 1400, stampHeight: 98, margin: 56 });
  assert.deepEqual(stampLayout(600), { outputWidth: 600, stampHeight: 42, margin: 24 });
});

test('property: the stamp always fits, and keeps its proportions', () => {
  fc.assert(
    fc.property(fc.integer({ min: 100, max: 10000 }), (width) => {
      const { outputWidth, stampHeight, margin } = stampLayout(width);
      assert.ok(outputWidth <= 1400);
      assert.ok(margin + stampHeight < outputWidth);
      assert.ok(Math.abs(stampHeight / outputWidth - 0.07) < 0.01);
    }),
  );
});

test('stampArgs places the stamp lower left and strips metadata', () => {
  assert.deepEqual(stampArgs('in.png', 'out.jpg', 3000), [
    '-y', '-loglevel', 'error',
    '-i', 'in.png', '-i', STAMP,
    '-filter_complex',
    '[0:v]scale=1400:-2[art];[1:v]scale=-1:98:flags=lanczos[stamp];[art][stamp]overlay=56:main_h-overlay_h-56',
    '-map_metadata', '-1',
    '-frames:v', '1', '-update', '1', '-q:v', '3',
    'out.jpg',
  ]);
});

/** Average color of a region, as [r, g, b]. */
function regionColor(file, x, y, size) {
  const raw = execFileSync('ffmpeg', [
    '-loglevel', 'error', '-i', file,
    '-vf', `crop=${size}:${size}:${x}:${y},scale=1:1`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  return [...raw];
}

test('stampCover draws gold in the lower left only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-cover-test-'));
  const art = join(dir, 'art.png');
  const output = join(dir, 'cover.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=2000x2000', '-frames:v', '1', art]);

  stampCover(art, output);

  // The E's top bar starts 98 + 56 px above the bottom, 56 px from the left.
  const [r, g, b] = regionColor(output, 60, 1400 - 56 - 98 + 2, 8);
  assert.ok(r > 180 && g > 150 && b < 170, `expected gold, got ${[r, g, b]}`);
  assert.deepEqual(regionColor(output, 1300, 1300, 8).map((v) => v < 20), [true, true, true]);
  assert.deepEqual(regionColor(output, 60, 60, 8).map((v) => v < 20), [true, true, true]);
});

test('the CLI explains its usage', () => {
  assert.throws(
    () => execFileSync('node', [join(REPO, 'scripts/stamp-cover.mjs')], { stdio: 'pipe' }),
    (err) => err.status === 1 && /Usage/.test(err.stderr.toString()),
  );
});
