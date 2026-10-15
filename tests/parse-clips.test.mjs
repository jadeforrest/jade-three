/**
 * Unit + property tests for parseClips in scripts/generate-clips.mjs
 * Run with: node --test tests/parse-clips.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseClips } from '../scripts/generate-clips.mjs';

const URL = 'https://jadethreemusic.com/releases/la-mitica';

const text = (t) => [{ type: 'text', text: t }];

// ── Block selection ──────────────────────────────────────────────────────────

test('reads the text block when it is the only block', () => {
  assert.deepEqual(parseClips(text('One clip.'), URL), ['One clip.']);
});

test('finds the text block behind a leading thinking block', () => {
  const content = [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'One clip.' },
  ];
  assert.deepEqual(parseClips(content, URL), ['One clip.']);
});

test('returns no clips when the response carries no text block', () => {
  assert.deepEqual(parseClips([{ type: 'thinking', thinking: '' }], URL), []);
  assert.deepEqual(parseClips([], URL), []);
  assert.deepEqual(parseClips(undefined, URL), []);
});

// ── Splitting ────────────────────────────────────────────────────────────────

test('splits on a --- line', () => {
  assert.deepEqual(parseClips(text('First.\n---\nSecond.'), URL), ['First.', 'Second.']);
});

test('drops empty segments from trailing or doubled separators', () => {
  assert.deepEqual(parseClips(text('Only.\n---\n\n---\n'), URL), ['Only.']);
});

test('leaves an inline --- inside a line alone', () => {
  assert.deepEqual(parseClips(text('A -- dash --- inside.'), URL), ['A -- dash --- inside.']);
});

// ── URL stripping ────────────────────────────────────────────────────────────

test('strips the URL the model appended despite instructions', () => {
  assert.deepEqual(parseClips(text(`A clip.\n\n${URL}`), URL), ['A clip.']);
});

test('leaves a URL that is not at the end alone', () => {
  const t = `Go to ${URL} right now.`;
  assert.deepEqual(parseClips(text(t), URL), [t]);
});

// The old implementation escaped only "/", so "." matched any character and a
// near-miss host was stripped as if it were the real URL.
test('does not strip a lookalike URL differing only where a dot sits', () => {
  const lookalike = 'https://jadethreemusicXcom/releases/la-mitica';
  assert.deepEqual(parseClips(text(`A clip.\n\n${lookalike}`), URL), [`A clip.\n\n${lookalike}`]);
});

test('handles a URL containing regex metacharacters', () => {
  const weird = 'https://example.com/a+b?x=1(2)[3]';
  assert.deepEqual(parseClips(text(`A clip.\n\n${weird}`), weird), ['A clip.']);
});

// ── Properties ───────────────────────────────────────────────────────────────

// Clip bodies that survive a round trip: no separator line, no leading/trailing
// whitespace, and non-empty once trimmed.
const clipBody = fc
  .string({ minLength: 1, maxLength: 60 })
  .map((s) => s.replace(/[\r\n]/g, ' ').trim())
  .filter((s) => s.length > 0 && !/^-{3,}$/.test(s));

test('property: joining clips with --- round-trips back to the same clips', () => {
  fc.assert(
    fc.property(fc.array(clipBody, { minLength: 1, maxLength: 12 }), (clips) => {
      assert.deepEqual(parseClips(text(clips.join('\n---\n')), URL), clips);
    }),
    { numRuns: 500 },
  );
});

test('property: parsing is idempotent', () => {
  fc.assert(
    fc.property(fc.array(clipBody, { minLength: 1, maxLength: 12 }), (clips) => {
      const once = parseClips(text(clips.join('\n---\n')), URL);
      assert.deepEqual(parseClips(text(once.join('\n---\n')), URL), once);
    }),
    { numRuns: 500 },
  );
});

test('property: a trailing URL is always stripped, whatever the clip body', () => {
  fc.assert(
    fc.property(clipBody, (clip) => {
      assert.deepEqual(parseClips(text(`${clip}\n\n${URL}`), URL), [clip]);
    }),
    { numRuns: 500 },
  );
});

test('property: no clip is ever empty or untrimmed', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 400 }), (raw) => {
      for (const clip of parseClips(text(raw), URL)) {
        assert.ok(clip.length > 0, 'empty clip');
        assert.equal(clip, clip.trim(), 'untrimmed clip');
      }
    }),
    { numRuns: 1000 },
  );
});

test('property: never throws on arbitrary block arrays', () => {
  const block = fc.oneof(
    fc.record({ type: fc.constant('text'), text: fc.string({ maxLength: 200 }) }),
    fc.record({ type: fc.constant('thinking'), thinking: fc.string({ maxLength: 50 }) }),
    fc.record({ type: fc.string({ maxLength: 12 }) }),
  );
  fc.assert(
    fc.property(fc.array(block, { maxLength: 6 }), (content) => {
      assert.ok(Array.isArray(parseClips(content, URL)));
    }),
    { numRuns: 500 },
  );
});
