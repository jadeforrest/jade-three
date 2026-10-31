/**
 * Unit + property tests for scripts/encode-media.mjs
 * Run with: node --test tests/encode-media.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { clipArgs, coverArgs, parseArgs, parseTime } from '../scripts/encode-media.mjs';

test('parseTime reads seconds and m:ss', () => {
  assert.equal(parseTime('95'), 95);
  assert.equal(parseTime('12.5'), 12.5);
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
    slug: 'stinger', track: 1, master: 'm.wav', start: 0, length: 30, cover: null,
  });
});

test('parseArgs reads flags', () => {
  const options = parseArgs(['ep', '2', 'm.wav', '--start', '1:05', '--length', '20', '--cover', 'a.png']);
  assert.equal(options.start, 65);
  assert.equal(options.length, 20);
  assert.equal(options.cover, 'a.png');
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['../etc', '1', 'm.wav']), /Usage/);
  assert.throws(() => parseArgs(['a', '0', 'm.wav']), /Invalid track/);
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--bogus', 'x']), /Unknown option/);
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--start']), /Missing value/);
  assert.throws(() => parseArgs(['a', '1', 'm.wav', '--length', '2']), /over 2 seconds/);
});

test('clipArgs trims, strips metadata, and fades out at the end of the clip', () => {
  const args = clipArgs({ master: 'm.wav', start: 65, length: 30 }, 'out.mp3');
  assert.equal(args[args.indexOf('-ss') + 1], '65');
  assert.equal(args[args.indexOf('-t') + 1], '30');
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.match(args[args.indexOf('-af') + 1], /afade=t=out:st=28:d=2/);
  assert.equal(args.at(-1), 'out.mp3');
});

test('property: the master path stays one argument, whatever it contains', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), (master) => {
      const clip = clipArgs({ master, start: 0, length: 30 }, 'o.mp3');
      assert.equal(clip[clip.indexOf('-i') + 1], master);
      const cover = coverArgs(master, 'o.jpg');
      assert.equal(cover[cover.indexOf('-i') + 1], master);
    }),
  );
});
