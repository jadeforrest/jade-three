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
import { checkArtwork, parseCli, stampArgs, stampCover, stampFile, stampLayout } from '../scripts/stamp-cover.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = join(REPO, 'brand/jade-three-e-gold.png');

test('stampLayout scales from the output width, capped per target', () => {
  assert.deepEqual(stampLayout(3000, 'site'), { outputWidth: 1400, stampHeight: 98, margin: 56 });
  assert.deepEqual(stampLayout(600, 'site'), { outputWidth: 600, stampHeight: 42, margin: 24 });
  assert.deepEqual(stampLayout(3000, 'distribution'), { outputWidth: 3000, stampHeight: 210, margin: 120 });
  assert.equal(stampLayout(8000, 'distribution').outputWidth, 6000);
});

test('stampLayout rejects an unknown or missing target', () => {
  for (const target of [undefined, 'web', 'toString']) {
    assert.throws(() => stampLayout(3000, target), /Unknown target/);
  }
});

test('property: the stamp always fits, and keeps its proportions', () => {
  fc.assert(
    fc.property(fc.integer({ min: 100, max: 10000 }), fc.constantFrom('site', 'distribution'), (width, target) => {
      const { outputWidth, stampHeight, margin } = stampLayout(width, target);
      assert.ok(outputWidth <= (target === 'site' ? 1400 : 6000));
      assert.equal(outputWidth, Math.min(width, target === 'site' ? 1400 : 6000));
      assert.ok(margin + stampHeight < outputWidth);
      assert.ok(Math.abs(stampHeight / outputWidth - 0.07) < 0.01);
    }),
  );
});

test('property: distribution artwork passes exactly when square and at least 1500', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 10000 }), fc.integer({ min: 1, max: 10000 }), (width, height) => {
      const ok = width === height && width >= 1500;
      if (ok) checkArtwork(width, height, 'distribution');
      else assert.throws(() => checkArtwork(width, height, 'distribution'), /must be/);
      checkArtwork(width, height, 'site');
    }),
  );
});

test('stampArgs places the stamp lower left and strips metadata', () => {
  assert.deepEqual(stampArgs('in.png', 'out.jpg', 3000, { target: 'site' }), [
    '-y', '-loglevel', 'error',
    '-i', 'in.png', '-i', STAMP,
    '-filter_complex',
    '[0:v]scale=1400:-2[art];[1:v]scale=-1:98:flags=lanczos[stamp];[art][stamp]overlay=56:main_h-overlay_h-56',
    '-map_metadata', '-1',
    '-frames:v', '1', '-update', '1', '-q:v', '3',
    'out.jpg',
  ]);
});

test('stampFile picks the brand file and rejects anything else', () => {
  assert.equal(stampFile('gold'), STAMP);
  assert.equal(stampFile('dark'), join(REPO, 'brand/jade-three-e-dark.png'));
  for (const name of ['light', 'toString', undefined]) {
    assert.throws(() => stampFile(name), /Unknown stamp/);
  }
});

test('stampArgs leaves artwork that is already at size unscaled', () => {
  const filter = (width, target) => stampArgs('in.png', 'out.jpg', width, { target })[8];
  assert.match(filter(2967, 'distribution'), /^\[0:v\]null\[art\];/);
  assert.match(filter(800, 'site'), /^\[0:v\]null\[art\];/);
  assert.match(filter(7000, 'distribution'), /^\[0:v\]scale=6000:-2\[art\];/);
});

test('stampArgs uses the requested stamp', () => {
  const args = stampArgs('in.png', 'out.jpg', 3000, { target: 'site', stamp: 'dark' });
  assert.equal(args[args.lastIndexOf('-i') + 1], join(REPO, 'brand/jade-three-e-dark.png'));
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

/** Solid artwork of exactly width x height (lavfi's color source rounds odd sizes, so crop down). */
function solidArt(width, height, color = 'black') {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-cover-test-'));
  const art = join(dir, 'art.png');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${width + 1}x${height + 1}`,
    '-vf', `format=rgb24,crop=${width}:${height}:0:0`, '-frames:v', '1', art,
  ]);
  return { art, output: join(dir, 'cover.jpg') };
}

test('stampCover draws gold in the lower left only', () => {
  const { art, output } = solidArt(2000, 2000, 'black');

  stampCover(art, output, { target: 'site' });

  // The E's top bar starts 98 + 56 px above the bottom, 56 px from the left.
  const [r, g, b] = regionColor(output, 60, 1400 - 56 - 98 + 2, 8);
  assert.ok(r > 180 && g > 150 && b < 170, `expected gold, got ${[r, g, b]}`);
  assert.deepEqual(regionColor(output, 1300, 1300, 8).map((v) => v < 20), [true, true, true]);
  assert.deepEqual(regionColor(output, 60, 60, 8).map((v) => v < 20), [true, true, true]);
});

test('the dark stamp draws near-black on light artwork', () => {
  const { art, output } = solidArt(2000, 2000, 'white');

  stampCover(art, output, { target: 'site', stamp: 'dark' });

  assert.ok(regionColor(output, 60, 1400 - 56 - 98 + 2, 8).every((v) => v < 40));
  assert.ok(regionColor(output, 1300, 1300, 8).every((v) => v > 235));
});

function dimensions(file) {
  return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf-8' }).trim();
}

test('a distribution cover keeps odd pixel sizes exactly', () => {
  const { art, output } = solidArt(2967, 2967);
  stampCover(art, output, { target: 'distribution' });
  assert.equal(dimensions(output), '2967,2967');
  // 7% of 2967 = 208 px stamp, 119 px margin.
  const [r, g, b] = regionColor(output, 123, 2967 - 119 - 208 + 3, 8);
  assert.ok(r > 180 && g > 150 && b < 170, `expected gold, got ${[r, g, b]}`);
});

test('stampCover refuses small or non-square distribution artwork before writing', () => {
  for (const [width, height] of [[1499, 1499], [3000, 2000]]) {
    const { art, output } = solidArt(width, height);
    assert.throws(() => stampCover(art, output, { target: 'distribution' }), /must be/);
    assert.throws(() => dimensions(output));
  }
});

test('parseCli needs exactly one target', () => {
  assert.deepEqual(parseCli(['a.jpg', 'b.jpg', '--site']), { input: 'a.jpg', output: 'b.jpg', target: 'site', stamp: 'gold' });
  assert.deepEqual(parseCli(['a.jpg', 'b.jpg', '--stamp', 'dark', '--distribution']),
    { input: 'a.jpg', output: 'b.jpg', target: 'distribution', stamp: 'dark' });
  for (const argv of [
    ['a.jpg', 'b.jpg'],
    ['a.jpg', 'b.jpg', '--site', '--distribution'],
    ['a.jpg', 'b.jpg', '--site', '--stamp'],
    ['a.jpg', 'b.jpg', '--full-size'],
    ['a.jpg', '--site'],
  ]) {
    assert.equal(parseCli(argv), null, argv.join(' '));
  }
});

test('the CLI reports artwork that fails its target', () => {
  const { art, output } = solidArt(1400, 1400);
  assert.throws(
    () => execFileSync('node', [join(REPO, 'scripts/stamp-cover.mjs'), art, output, '--distribution'], { stdio: 'pipe' }),
    (err) => err.status === 1 && /at least 1500/.test(err.stderr.toString()),
  );
});

test('the CLI explains its usage', () => {
  assert.throws(
    () => execFileSync('node', [join(REPO, 'scripts/stamp-cover.mjs')], { stdio: 'pipe' }),
    (err) => err.status === 1 && /Usage/.test(err.stderr.toString()),
  );
});
