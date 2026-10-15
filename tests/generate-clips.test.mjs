/**
 * Unit + property tests for validateClips in scripts/generate-clips.mjs
 * Run with: node --test tests/generate-clips.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClips } from '../scripts/generate-clips.mjs';

const URL = 'https://jadethreemusic.com/releases/la-mitica';

// ── Example-based ────────────────────────────────────────────────────────────

test('keeps a well-formed clip', () => {
  const clips = ['"La Mítica" is out now.'];
  const { kept, warnings } = validateClips(clips, URL);
  assert.deepEqual(kept, clips);
  assert.equal(warnings.length, 0);
});

test('drops the real truncated clip from the La Mítica batch', () => {
  const truncated =
    '"Me tiene loca con su mirada" — he\'s got me crazy with that look of his. ' +
    'Then the mind goes tick-tock and the whole song just drops. Stream "La Mítica" and feel';
  const { kept, warnings } = validateClips([truncated], URL);
  assert.deepEqual(kept, []);
  assert.ok(warnings.some(w => w.includes('mid-sentence')));
  assert.ok(warnings.some(w => w.includes('1 of 1')));
});

test('accepts every terminal punctuation mark', () => {
  const clips = ['Ends in a period.', 'Ends in a bang!', 'Ends in a question?', 'Trails off…'];
  const { kept } = validateClips(clips, URL);
  assert.equal(kept.length, 4);
});

test('accepts terminal punctuation followed by a closing quote', () => {
  const clips = ['He said "that song just blows me away."', "She called it 'insane!'"];
  const { kept } = validateClips(clips, URL);
  assert.equal(kept.length, 2);
});

test('keeps an over-budget clip but warns about it', () => {
  const long = 'x'.repeat(400) + '.';
  const { kept, warnings } = validateClips([long], URL);
  assert.deepEqual(kept, [long]);
  assert.ok(warnings.some(w => w.includes('over 300 chars')));
  assert.ok(!warnings.some(w => w.includes('dropped as unusable')));
});

test('warns when the response hit the token ceiling', () => {
  const { warnings } = validateClips(['Fine.'], URL, 'max_tokens');
  assert.ok(warnings.some(w => w.includes('max_tokens')));
});

test('does not warn about the ceiling on a normal stop', () => {
  const { warnings } = validateClips(['Fine.'], URL, 'end_turn');
  assert.equal(warnings.length, 0);
});

test('handles an empty batch', () => {
  const { kept, warnings } = validateClips([], URL);
  assert.deepEqual(kept, []);
  assert.equal(warnings.length, 0);
});

// ── Property-based ───────────────────────────────────────────────────────────
// Deterministic LCG so failures reproduce exactly.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function arbClip(rand) {
  const words = ['beat', 'bass', 'swagger', 'rosas', 'Mítica', 'groove', 'drums', 'Splice'];
  const n = 1 + Math.floor(rand() * 12);
  const body = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ');
  const enders = ['.', '!', '?', '…', '."', ".'", '?)', ''];
  const ender = enders[Math.floor(rand() * enders.length)];
  return { text: body + ender, wellFormed: ender !== '' };
}

test('property: every kept clip ends in terminal punctuation', () => {
  const rand = rng(20261015);
  for (let i = 0; i < 2000; i++) {
    const batch = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => arbClip(rand));
    const { kept } = validateClips(batch.map(c => c.text), URL);
    for (const k of kept) {
      assert.match(k, /[.!?…]["'”’)\]]*$/, `kept a clip with no terminal punctuation: ${JSON.stringify(k)}`);
    }
  }
});

test('property: well-formed clips are never dropped, and nothing is invented', () => {
  const rand = rng(777);
  for (let i = 0; i < 2000; i++) {
    const batch = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => arbClip(rand));
    const texts = batch.map(c => c.text);
    const { kept } = validateClips(texts, URL);

    // Never returns more than it was given, and only ever returns its inputs.
    assert.ok(kept.length <= texts.length);
    for (const k of kept) assert.ok(texts.includes(k));

    // Every well-formed input survives.
    for (const c of batch) {
      if (c.wellFormed) assert.ok(kept.includes(c.text), `dropped a well-formed clip: ${JSON.stringify(c.text)}`);
    }

    // Order is preserved.
    assert.deepEqual(kept, texts.filter(t => kept.includes(t)));
  }
});

test('property: dropped count always matches the summary warning', () => {
  const rand = rng(31337);
  for (let i = 0; i < 1000; i++) {
    const texts = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => arbClip(rand).text);
    const { kept, warnings } = validateClips(texts, URL);
    const dropped = texts.length - kept.length;
    const summary = warnings.find(w => w.includes('dropped as unusable'));
    if (dropped === 0) {
      assert.equal(summary, undefined);
    } else {
      assert.ok(summary.includes(`${dropped} of ${texts.length}`));
    }
  }
});

test('property: validateClips is idempotent over its own output', () => {
  const rand = rng(99);
  for (let i = 0; i < 1000; i++) {
    const texts = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => arbClip(rand).text);
    const once = validateClips(texts, URL).kept;
    const twice = validateClips(once, URL).kept;
    assert.deepEqual(twice, once);
  }
});
