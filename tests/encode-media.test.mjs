/**
 * Unit + property tests for scripts/encode-media.mjs
 * Run with: node --test tests/encode-media.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { clipArgs, encode, parseArgs, parseTime } from '../scripts/encode-media.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

test('parseTime reads seconds and m:ss', () => {
  assert.equal(parseTime('95'), 95);
  assert.equal(parseTime('12.5'), 12.5);
  assert.equal(parseTime('12.75'), 12.75);
  assert.equal(parseTime('1:35'), 95);
});

test('parseTime rejects anything else', () => {
  for (const value of ['', '1:5', '1:60', 'abc', '-1', '1:2:3']) {
    assert.throws(() => parseTime(value), /Invalid time/);
  }
});

test('property: m:ss parses to the seconds it was formatted from', () => {
  fc.assert(
    fc.property(fc.nat(5000), (seconds) => {
      const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      assert.equal(parseTime(text), seconds);
    }),
  );
});

test('parseArgs applies defaults', () => {
  assert.deepEqual(parseArgs(['stinger', '1', 'm.wav']), {
    slug: 'stinger', track: 1, master: 'm.wav', start: 0, length: 30, cover: null, stamp: 'gold',
  });
});

test('parseArgs reads flags', () => {
  const options = parseArgs(['ep', '2', 'm.wav', '--start', '1:05', '--length', '20', '--cover', 'a.png']);
  assert.equal(options.start, 65);
  assert.equal(options.length, 20);
  assert.equal(options.cover, 'a.png');
  assert.equal(parseArgs(['ep', '2', 'm.wav', '--stamp', 'dark']).stamp, 'dark');
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['../etc', '1', 'm.wav']), /Usage/);
  assert.throws(() => parseArgs(['a', '1']), /Usage/);
  assert.throws(() => parseArgs(['a/', '1', 'm.wav']), /Usage/);
  for (const track of ['0', 'x1', '1x', '100', '1a']) {
    assert.throws(() => parseArgs(['a', track, 'm.wav']), /Invalid track/);
  }
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--bogus', 'x']), /Unknown option/);
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--start']), /Missing value/);
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--length', '2']), /over 2 seconds/);
});

test('clipArgs trims, normalizes, fades, and encodes at 128k', () => {
  assert.deepEqual(clipArgs({ master: 'm.wav', start: 65, length: 30 }, 'out.mp3'), [
    '-y', '-loglevel', 'error',
    '-ss', '65', '-t', '30', '-i', 'm.wav',
    '-map', '0:a:0', '-map_metadata', '-1',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.5,afade=t=out:st=28:d=2',
    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k',
    'out.mp3',
  ]);
});

test('property: the master path stays one argument, whatever it contains', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), (master) => {
      const clip = clipArgs({ master, start: 0, length: 30 }, 'o.mp3');
      assert.equal(clip[clip.indexOf('-i') + 1], master);
    }),
  );
});

// ── End to end, with real ffmpeg, against a throwaway site ───────────────────

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

function makeSite() {
  const root = mkdtempSync(join(tmpdir(), 'encode-media-test-'));
  mkdirSync(join(root, 'src/content/songs'), { recursive: true });
  mkdirSync(join(root, 'src/data'), { recursive: true });
  writeFileSync(join(root, 'src/content/songs/song.md'), '---\nreleaseId: "r1"\n---\n');
  writeFileSync(join(root, 'src/content/songs/orphan.md'), '---\nreleaseId: "gone"\n---\n');
  writeFileSync(
    join(root, 'src/data/releases.json'),
    JSON.stringify({
      releases: [{
        id: 'r1',
        title: 'Song',
        artworkUrl: 'https://art.test/x/600x600bb.jpg',
        tracks: [{ trackNumber: 1 }, { trackNumber: 12 }],
      }],
    }),
  );
  const master = join(root, 'master.wav');
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-metadata', 'title=secret', master);
  const art = join(root, 'art.png');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=2000x2000', '-frames:v', '1', art);
  return { root, master, art, folder: join(root, 'src/assets/media/song') };
}

function probe(file, entries) {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf-8' },
  ).trim();
}

const stubArtwork = (t, respond) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return respond();
  });
  return calls;
};

test('encode writes a padded clip and resized cover', { skip: !hasFfmpeg }, async () => {
  const { root, master, art, folder } = makeSite();
  await encode(['song', '12', master, '--start', '1', '--length', '5', '--cover', art], root);

  const clip = join(folder, '12.mp3');
  assert.ok(Math.abs(Number(probe(clip, 'format=duration')) - 5) < 0.2);
  assert.ok(!probe(clip, 'format_tags').includes('secret'));
  assert.equal(probe(join(folder, 'cover.jpg'), 'stream=width'), '1400');
});

test('encode downloads the 3000px artwork when there is no cover', { skip: !hasFfmpeg }, async (t) => {
  const { root, master, art, folder } = makeSite();
  const png = readFileSync(art);
  const calls = stubArtwork(t, () => new Response(png));
  await encode(['song', '1', master, '--length', '5'], root);
  assert.deepEqual(calls, ['https://art.test/x/3000x3000bb.jpg']);
  assert.ok(existsSync(join(folder, 'cover.jpg')));
  assert.ok(existsSync(join(folder, '01.mp3')));
});

test('encode keeps an existing cover', { skip: !hasFfmpeg }, async (t) => {
  const { root, master, art, folder } = makeSite();
  await encode(['song', '1', master, '--length', '5', '--cover', art], root);
  const before = statSync(join(folder, 'cover.jpg')).mtimeMs;
  const calls = stubArtwork(t, () => new Response(''));
  await encode(['song', '12', master, '--length', '5'], root);
  assert.equal(calls.length, 0);
  assert.equal(statSync(join(folder, 'cover.jpg')).mtimeMs, before);
});

test('encode reports a failed artwork download', { skip: !hasFfmpeg }, async (t) => {
  const { root, master } = makeSite();
  stubArtwork(t, () => new Response('', { status: 404 }));
  await assert.rejects(encode(['song', '1', master, '--length', '5'], root), /Artwork download failed: 404/);
});

test('encode rejects a slug, release, or track the site does not have', { skip: !hasFfmpeg }, async () => {
  const { root, master, folder } = makeSite();
  await assert.rejects(encode(['nope', '1', master], root), /No song page/);
  await assert.rejects(encode(['orphan', '1', master], root), /No release for orphan: gone/);
  await assert.rejects(encode(['song', '2', master], root), /"Song" has no track 2/);
  writeFileSync(join(root, 'src/content/songs/blank.md'), '---\ntitle: "x"\n---\n');
  await assert.rejects(encode(['blank', '1', master], root), /No release for blank/);
  assert.ok(!existsSync(folder));
});

test('the CLI prints errors and exits 1', () => {
  assert.throws(
    () => execFileSync('node', [join(REPO, 'scripts/encode-media.mjs')], { stdio: 'pipe' }),
    (err) => err.status === 1 && /Usage/.test(err.stderr.toString()),
  );
});
