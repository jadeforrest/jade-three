/**
 * Unit + property tests for dedupeReleases in scripts/fetch-releases.js.
 * Run with: node --test tests/fetch-releases.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildRelease, buildTrack, dedupeReleases, syncReleases } from '../scripts/fetch-releases.js';

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

// ---------------------------------------------------------------------------
// syncReleases against a fake iTunes
// ---------------------------------------------------------------------------

const silent = { log: quiet, warn: quiet };
const noPause = async () => {};

/** A fake iTunes `get`: artist search, album lookup, and per-album tracks (an Error rejects). */
function fakeItunes({ artists = [{ wrapperType: 'artist', artistName: 'Jade Three', artistId: 7 }], albums = [], tracks = {} }) {
  return async (u) => {
    const id = Number(new URL(u).searchParams.get('id'));
    if (u.includes('/search')) return { results: artists };
    if (u.includes('entity=album')) return { results: [{ wrapperType: 'artist' }, ...albums.map((a) => ({ wrapperType: 'collection', ...a }))] };
    if (tracks[id] instanceof Error) throw tracks[id];
    return { results: (tracks[id] ?? []).map((t) => ({ wrapperType: 'track', ...t })) };
  };
}

test('syncReleases merges, dedupes, keeps upcoming hand-added releases, and sorts newest first', async () => {
  const id = 'single-3vEU0S9UYRrS8YJAZOToMG';
  const existing = [
    { id, type: 'single', title: "Didn't you want something?", appleMusicUrl: url(1784829412), spotifyUrl: 'sp', releaseDate: '2024-12-06' },
    { id: 'single-upcoming', title: 'Unincorporated', releaseDate: '2026-11-27' },
    { id: 'single-gone', title: 'Old Unlisted', releaseDate: '2020-01-01' },
  ];
  const albums = [
    album({ collectionId: 6823384523, collectionName: "Didn't You Want Something? - Single", collectionViewUrl: url(6823384523), releaseDate: '2024-12-06T08:00:00Z' }),
    album({ collectionId: 1784829412, collectionName: "Didn't you want something? - Single", collectionViewUrl: url(1784829412), releaseDate: '2024-12-06T08:00:00Z' }),
    album({ collectionId: 55, collectionName: 'Brand New', collectionViewUrl: url(55), releaseDate: '2026-02-01T08:00:00Z' }),
  ];
  const warnings = [];
  const pauses = [];
  const releases = await syncReleases({
    get: fakeItunes({ albums, tracks: { 55: [itunesTrack({ trackName: 'Brand New' })] } }),
    existing,
    today: '2026-11-16',
    pause: async (ms) => pauses.push(ms),
    out: { log: quiet, warn: (m) => warnings.push(m) },
  });

  assert.deepEqual(releases.map((r) => r.id), ['single-upcoming', 'single-55', id]);
  assert.equal(releases[2].appleMusicUrl, url(1784829412));
  assert.equal(releases[2].spotifyUrl, 'sp');
  assert.equal(releases[1].tracks[0].title, 'Brand New');
  assert.equal(pauses.length, 3);
  assert.equal(warnings.length, 1);
});

test('syncReleases keeps a release without tracks when its track lookup fails', async () => {
  const warnings = [];
  const releases = await syncReleases({
    get: fakeItunes({ albums: [album({ trackCount: 3 })], tracks: { 42: new Error('503') } }),
    existing: [],
    today: '2026-11-16',
    pause: noPause,
    out: { log: quiet, warn: (m) => warnings.push(m) },
  });
  assert.equal(releases.length, 1);
  assert.deepEqual(releases[0].tracks, []);
  assert.equal(releases[0].totalTracks, 3);
  assert.match(warnings[0], /could not fetch tracks \(503\)/);
});

test('syncReleases fails when iTunes has no artist named Jade Three', async () => {
  await assert.rejects(
    syncReleases({ get: fakeItunes({ artists: [{ wrapperType: 'artist', artistName: 'Jade Two' }] }), existing: [], today: '2026-11-16', pause: noPause, out: silent }),
    /Artist "Jade Three" not found/,
  );
});

test('syncReleases treats missing iTunes results as no albums', async () => {
  const get = async (u) => (u.includes('/search') ? { results: [{ wrapperType: 'artist', artistName: 'jade three', artistId: 1 }] } : {});
  assert.deepEqual(await syncReleases({ get, existing: [], today: '2026-11-16', pause: noPause, out: silent }), []);
});
