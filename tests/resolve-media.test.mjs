/**
 * Unit + property tests for src/lib/resolve-media.ts
 * Run with: node --test tests/resolve-media.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildMediaIndex, resolvePlayer } from '../src/lib/resolve-media.ts';

const ALBUM_ID = 'a'.repeat(22);
const TRACK_ID = 't'.repeat(22);

const track = (trackNumber, spotifyId = TRACK_ID) => ({
  trackNumber,
  title: `Track ${trackNumber}`,
  spotifyId,
});
const release = (type, tracks) => ({ id: 'r', title: 'Release', type, spotifyId: ALBUM_ID, tracks });

const audioPath = (slug, n) => `/src/assets/media/${slug}/${String(n).padStart(2, '0')}.mp3`;
const coverPath = (slug) => `/src/assets/media/${slug}/cover.jpg`;

function indexFor(slug, trackNumbers, songSlugs = [slug]) {
  const audio = Object.fromEntries(trackNumbers.map((n) => [audioPath(slug, n), `/clip-${n}.mp3`]));
  return buildMediaIndex(audio, { [coverPath(slug)]: 'cover' }, songSlugs);
}

// ── buildMediaIndex ──────────────────────────────────────────────────────────

test('indexes clips by track number', () => {
  const index = indexFor('ep', [1, 12]);
  assert.equal(index.get('ep').audio.get(12), '/clip-12.mp3');
  assert.equal(index.get('ep').cover, 'cover');
});

test('no media files gives an empty index', () => {
  assert.equal(buildMediaIndex({}, {}, ['stinger']).size, 0);
});

test('rejects misnamed clips', () => {
  for (const file of ['1.mp3', 'clip.mp3', '00.mp3', '001.mp3']) {
    assert.throws(
      () => buildMediaIndex({ [`/src/assets/media/a/${file}`]: 'u' }, { [coverPath('a')]: 'c' }, ['a']),
      /must be named like 01\.mp3/,
    );
  }
});

test('rejects clip names with anything after .mp3', () => {
  assert.throws(
    () => buildMediaIndex({ '/src/assets/media/a/01.mp3.mp3': 'u' }, { [coverPath('a')]: 'c' }, ['a']),
    /must be named like 01\.mp3/,
  );
});

test('rejects a file directly in the media root', () => {
  assert.throws(() => buildMediaIndex({ '/src/assets/media/01.mp3': 'u' }, {}, []), /Unexpected media path/);
});

test('rejects a folder with no song page', () => {
  assert.throws(() => indexFor('typo', [1], ['stinger']), /no song page: typo/);
});

test('rejects a folder with no cover', () => {
  assert.throws(() => buildMediaIndex({ [audioPath('a', 1)]: 'u' }, {}, ['a']), /missing cover\.jpg: a/);
});

test('rejects paths outside the media layout', () => {
  assert.throws(() => buildMediaIndex({ '/elsewhere/01.mp3': 'u' }, {}, []), /Unexpected media path/);
  assert.throws(
    () => buildMediaIndex({ '/src/assets/media/a/b/01.mp3': 'u' }, {}, ['a']),
    /Unexpected media path/,
  );
});

// ── resolvePlayer: Spotify fallback ──────────────────────────────────────────

test('a single with no media embeds its track', () => {
  const plan = resolvePlayer(release('single', [track(1)]), ['s'], new Map());
  assert.deepEqual(plan, { kind: 'spotify', spotifyId: TRACK_ID, type: 'track', height: 152 });
});

test('a single with no track ID falls back to the album embed, never /embed/track', () => {
  const plan = resolvePlayer(release('single', [track(1, null)]), ['s'], new Map());
  assert.deepEqual(plan, { kind: 'spotify', spotifyId: ALBUM_ID, type: 'album', height: 152 });
});

test('an EP with no media embeds the album', () => {
  const plan = resolvePlayer(release('ep', [track(1), track(2)]), ['e'], new Map());
  assert.deepEqual(plan, { kind: 'spotify', spotifyId: ALBUM_ID, type: 'album', height: 352 });
});

test('an EP missing one clip stays on Spotify', () => {
  const plan = resolvePlayer(release('ep', [track(1), track(2)]), ['e'], indexFor('e', [1]));
  assert.equal(plan.kind, 'spotify');
});

test('a release with no tracks stays on Spotify', () => {
  assert.equal(resolvePlayer(release('ep', []), ['e'], new Map()).kind, 'spotify');
});

// ── resolvePlayer: local ─────────────────────────────────────────────────────

test('finds the folder under any of the release song pages', () => {
  const songSlugs = ['fight-or-flight', 'year-until-the-fall-ep'];
  const index = indexFor('year-until-the-fall-ep', [1, 2], songSlugs);
  const plan = resolvePlayer(release('ep', [track(1), track(2)]), songSlugs, index);
  assert.equal(plan.kind, 'local');
  assert.deepEqual(plan.tracks.map((t) => t.src), ['/clip-1.mp3', '/clip-2.mp3']);
});

test('rejects a clip for a track the release does not have', () => {
  assert.throws(
    () => resolvePlayer(release('single', [track(1)]), ['s'], indexFor('s', [1, 2])),
    /no track number 2/,
  );
});

test('names every stray clip', () => {
  assert.throws(
    () => resolvePlayer(release('single', [track(1)]), ['s'], indexFor('s', [1, 2, 3])),
    /no track number 2, 3 \(s\)/,
  );
});

test('rejects two folders for one release', () => {
  const index = new Map([...indexFor('a', [1]), ...indexFor('b', [1])]);
  assert.throws(
    () => resolvePlayer(release('ep', [track(1)]), ['a', 'b'], index),
    /several media folders: a, b/,
  );
});

// ── Properties ───────────────────────────────────────────────────────────────

const trackNumbers = fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 12 });

test('property: local exactly when every track has a clip, in release order', () => {
  fc.assert(
    fc.property(
      trackNumbers.chain((numbers) =>
        fc.tuple(fc.constant(numbers), fc.subarray(numbers), fc.constantFrom('single', 'ep', 'album')),
      ),
      ([numbers, withClips, type]) => {
        const rel = release(type, numbers.map((n) => track(n)));
        const plan = resolvePlayer(rel, ['s'], indexFor('s', withClips));
        if (withClips.length === numbers.length) {
          assert.equal(plan.kind, 'local');
          assert.deepEqual(plan.tracks.map((t) => t.trackNumber), numbers);
          assert.ok(plan.tracks.every((t) => t.src === `/clip-${t.trackNumber}.mp3`));
        } else {
          assert.equal(plan.kind, 'spotify');
        }
      },
    ),
  );
});

test('property: Spotify plans never put an album ID in a track embed', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('single', 'ep', 'album'),
      fc.array(fc.option(fc.constant(TRACK_ID)), { maxLength: 4 }),
      (type, ids) => {
        const rel = release(type, ids.map((id, i) => track(i + 1, id)));
        const plan = resolvePlayer(rel, ['s'], new Map());
        assert.equal(plan.type === 'track', plan.spotifyId === TRACK_ID);
        if (type !== 'single') assert.equal(plan.type, 'album');
      },
    ),
  );
});

test('property: an arbitrary file name never slips into the index unvalidated', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z0-9.]{1,8}$/), (name) => {
      const path = `/src/assets/media/a/${name}.mp3`;
      const covers = { [coverPath('a')]: 'c' };
      if (/^\d\d$/.test(name) && name !== '00') {
        assert.equal(buildMediaIndex({ [path]: 'u' }, covers, ['a']).get('a').audio.size, 1);
      } else {
        assert.throws(() => buildMediaIndex({ [path]: 'u' }, covers, ['a']));
      }
    }),
  );
});
