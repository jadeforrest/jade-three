/**
 * Unit + property tests for dedupeReleases in scripts/fetch-releases.js.
 * Run with: node --test tests/fetch-releases.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { dedupeReleases } from '../scripts/fetch-releases.js';

const url = (album) => `https://music.apple.com/us/album/x/${album}?uo=4`;
const quiet = () => {};

test('keeps the existing album when iTunes lists a second one under the same id', () => {
  const id = 'single-3vEU0S9UYRrS8YJAZOToMG';
  const existing = [{ id, appleMusicUrl: url(1784829412) }];
  const reissue = { id, title: "Didn't You Want Something?", appleMusicUrl: url(6823384523) };
  const original = { id, title: "Didn't you want something?", appleMusicUrl: url(1784829412) };
  const warnings = [];
  const out = dedupeReleases([reissue, original], existing, (m) => warnings.push(m));
  assert.deepEqual(out, [original]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /6823384523/);
});

test('without an existing entry, the first album seen wins', () => {
  const a = { id: 'x', appleMusicUrl: url(1) };
  const b = { id: 'x', appleMusicUrl: url(2) };
  assert.deepEqual(dedupeReleases([a, b], [], quiet), [a]);
});

const fetched = fc.array(
  fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd'), album: fc.integer({ min: 1, max: 6 }) }),
  { maxLength: 12 },
).map((rs) => rs.map((r, i) => ({ id: r.id, seq: i, appleMusicUrl: url(r.album) })));
const existingAlbums = fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.integer({ min: 1, max: 6 }));

test('property: one release per id, existing album wins, order and membership preserved', () => {
  fc.assert(
    fc.property(fetched, existingAlbums, (releases, albums) => {
      const existing = Object.entries(albums).map(([id, album]) => ({ id, appleMusicUrl: url(album) }));
      let warned = 0;
      const out = dedupeReleases(releases, existing, () => warned++);

      const ids = out.map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length, 'ids are unique');
      assert.deepEqual(new Set(ids), new Set(releases.map((r) => r.id)), 'every id survives');
      assert.equal(warned, releases.length - out.length, 'one warning per dropped release');
      assert.deepEqual(out, releases.filter((r) => out.includes(r)), 'original order kept');

      for (const r of out) {
        const want = albums[r.id] === undefined ? undefined : url(albums[r.id]);
        const candidates = releases.filter((c) => c.id === r.id);
        const match = candidates.find((c) => c.appleMusicUrl === want);
        assert.equal(r, match ?? candidates[0]);
      }
    }),
    { numRuns: 500 },
  );
});
