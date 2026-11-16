/**
 * Unit + property tests for dedupeReleases in scripts/fetch-releases.js.
 * Run with: node --test tests/fetch-releases.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildRelease, buildTrack, dedupeReleases } from '../scripts/fetch-releases.js';

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

// ---------------------------------------------------------------------------
// buildTrack / buildRelease
// ---------------------------------------------------------------------------

const album = (over = {}) => ({
  collectionId: 42,
  collectionName: 'Night Drive - Single',
  collectionViewUrl: url(42),
  releaseDate: '2025-03-07T08:00:00Z',
  artworkUrl100: 'https://img/a/100x100bb.jpg',
  trackCount: 1,
  ...over,
});
const itunesTrack = (over = {}) => ({
  trackNumber: 1,
  trackName: 'Night Drive',
  trackViewUrl: 'https://music.apple.com/track/1',
  trackTimeMillis: 185_400,
  trackExplicitness: 'notExplicit',
  ...over,
});

test('buildRelease without an existing entry derives id, type and title from iTunes', () => {
  const r = buildRelease(album(), [itunesTrack()], null);
  assert.equal(r.id, 'single-42');
  assert.equal(r.type, 'single');
  assert.equal(r.title, 'Night Drive');
  assert.equal(r.releaseDate, '2025-03-07');
  assert.equal(r.year, 2025);
  assert.equal(r.appleMusicUrl, url(42));
  assert.equal(r.artworkUrl, 'https://img/a/600x600bb.jpg');
  assert.equal(r.artworkUrlSmall, 'https://img/a/64x64bb.jpg');
  assert.equal(r.totalTracks, 1);
  assert.equal(r.spotifyUrl, null);
  assert.deepEqual(r.tracks, [buildTrack(itunesTrack(), null)]);
});

test('buildRelease falls back to the album track count and existing dates when iTunes omits them', () => {
  const existing = { id: 'ep-x', type: 'ep', title: 'X', releaseDate: '2020-01-02', year: 2020, appleMusicUrl: url(9) };
  const r = buildRelease(album({ releaseDate: undefined, collectionViewUrl: undefined, trackCount: 4 }), [], existing);
  assert.equal(r.totalTracks, 4);
  assert.equal(r.releaseDate, '2020-01-02');
  assert.equal(r.year, 2020);
  assert.equal(r.appleMusicUrl, url(9));
  assert.deepEqual(r.tracks, []);
  const bare = buildRelease(album({ releaseDate: undefined }), [], null);
  assert.equal(bare.releaseDate, '');
  assert.equal(bare.year, 0);
});

test('buildTrack formats duration, keeps hand-filled links, and falls back to existing data', () => {
  const t = buildTrack(itunesTrack({ trackExplicitness: 'explicit' }), null);
  assert.equal(t.durationFormatted, '3:05');
  assert.equal(t.isExplicit, true);
  const existing = { title: 'Night drive', spotifyId: 's', spotifyUrl: 'su', amazonMusicUrl: 'am', youtubeUrl: 'yt', appleMusicUrl: 'old', durationMs: 60_000 };
  const kept = buildTrack(itunesTrack({ trackViewUrl: undefined, trackTimeMillis: undefined }), existing);
  assert.deepEqual(
    [kept.title, kept.spotifyId, kept.spotifyUrl, kept.amazonMusicUrl, kept.youtubeUrl, kept.appleMusicUrl, kept.durationMs, kept.durationFormatted],
    ['Night drive', 's', 'su', 'am', 'yt', 'old', 60_000, '1:00'],
  );
  assert.equal(buildTrack(itunesTrack({ trackTimeMillis: undefined }), null).durationMs, 0);
});

const maybe = (arb) => fc.option(arb, { nil: null });
const handFilled = fc.record({
  id: fc.string({ minLength: 1 }),
  type: fc.constantFrom('single', 'ep', 'album'),
  title: fc.string({ minLength: 1 }),
  spotifyId: maybe(fc.string()),
  spotifyUrl: maybe(fc.webUrl()),
  amazonMusicUrl: maybe(fc.webUrl()),
  youtubePlaylistUrl: maybe(fc.webUrl()),
  youtubeUrl: maybe(fc.webUrl()),
});

test('property: an existing entry\'s id, type, title and hand-filled links always survive a sync', () => {
  fc.assert(
    fc.property(handFilled, fc.integer({ min: 1, max: 1e10 }), (existing, collectionId) => {
      const r = buildRelease(album({ collectionId, collectionViewUrl: url(collectionId) }), [itunesTrack()], existing);
      for (const key of Object.keys(existing)) assert.equal(r[key], existing[key], key);
      assert.equal(r.appleMusicUrl, url(collectionId), 'iTunes URL refreshes');
    }),
  );
});
