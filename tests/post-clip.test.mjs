/**
 * Unit tests for scripts/post-clip.mjs
 * Run with: node --test tests/post-clip.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/post-clip.mjs', import.meta.url).pathname;

function run(args) {
  return execSync(`node ${SCRIPT} --dry-run ${args}`, { encoding: 'utf-8' });
}

test('--dry-run prints clip text and exits without posting', () => {
  const out = run('--slug fall-in-love');
  assert.match(out, /Song:\s+fall-in-love/);
  assert.match(out, /\[Dry run\] Not posting/);
});

test('--slug filters to the specified song', () => {
  const out = run('--slug fall-in-love');
  const slugLine = out.match(/^Song:\s+(.+)$/m)?.[1]?.trim();
  assert.equal(slugLine, 'fall-in-love');
});

test('--slug with unknown slug exits with no eligible clips', () => {
  const out = run('--slug no-such-song');
  assert.match(out, /No approved, unsent clips available/);
});

test('missing BLUESKY_HANDLE exits with an error', () => {
  assert.throws(
    () =>
      execSync(`node ${SCRIPT} --slug fall-in-love`, {
        env: { ...process.env, BLUESKY_HANDLE: '', BLUESKY_APP_PASSWORD: '' },
        encoding: 'utf-8',
      }),
    (err) => {
      assert.match(err.stderr ?? err.message, /BLUESKY_HANDLE/);
      return true;
    }
  );
});

// ── bskyPost against a stubbed fetch (never touches the network) ──────────────

import { bskyPost } from '../scripts/post-clip.mjs';

const TEXT = 'A clip.\n\nhttps://jadethreemusic.com/releases/some-song';
const NO_WAIT = { delaysMs: [0, 0], sleep: async () => {}, log: () => {} };
const json = (body, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });
const netDown = () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', hostname: 'bsky.social' } }); };

/** Runs bskyPost with fetch replaced by `route(url, callNumberForThatUrl)`; returns the URLs called. */
async function withFetch(route, fn) {
  const calls = [];
  const orig = globalThis.fetch;
  const origWrite = process.stderr.write;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return route(String(url), calls.filter((u) => u === String(url)).length);
  };
  process.stderr.write = () => true;
  try {
    return { result: await fn().then((v) => ({ value: v }), (e) => ({ error: e })), calls };
  } finally {
    globalThis.fetch = orig;
    process.stderr.write = origWrite;
  }
}

const count = (calls, part) => calls.filter((u) => u.includes(part)).length;

function happyRoute(url) {
  if (url.includes('createSession')) return json({ did: 'did:plc:x', accessJwt: 'jwt', didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.test' }] } });
  if (url.includes('createRecord')) return json({ uri: 'at://did:plc:x/app.bsky.feed.post/1' });
  return { ok: true, text: async () => '<meta property="og:title" content="Some Song">' };
}

test('regression: "fetch failed" on sign-in (network not up after wake) is retried, then posts once', async () => {
  const { result, calls } = await withFetch(
    (url, n) => (url.includes('createSession') && n === 1 ? netDown() : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.equal(result.value.uri, 'at://did:plc:x/app.bsky.feed.post/1');
  assert.equal(count(calls, 'createSession'), 2);
  assert.equal(count(calls, 'https://pds.test/xrpc/com.atproto.repo.createRecord'), 1);
});

test('a network failure fetching the release page is retried', async () => {
  const { result, calls } = await withFetch(
    (url, n) => (url.includes('jadethreemusic.com') && n === 1 ? netDown() : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.ok(result.value);
  assert.equal(count(calls, 'jadethreemusic.com'), 2);
  assert.equal(count(calls, 'createRecord'), 1);
});

test('creating the post is never retried, so a dropped connection cannot double-post', async () => {
  const { result, calls } = await withFetch(
    (url) => (url.includes('createRecord') ? netDown() : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.equal(result.error.message, 'fetch failed');
  assert.equal(count(calls, 'createRecord'), 1);
});

test('sign-in gives up after the retries with an error naming the host and cause', async () => {
  const { result, calls } = await withFetch(
    (url) => (url.includes('createSession') ? netDown() : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.equal(result.error.message, 'Network error reaching bsky.social after 3 attempt(s): fetch failed (ENOTFOUND bsky.social)');
  assert.equal(calls.length, 3);
});

test('a rejected sign-in or post is reported with the server response, without retrying', async () => {
  const auth = await withFetch(
    (url) => (url.includes('createSession') ? json({ error: 'AuthenticationRequired' }, false) : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.match(auth.result.error.message, /^Bluesky auth failed: .*AuthenticationRequired/);
  assert.equal(auth.calls.length, 1);

  const post = await withFetch(
    (url) => (url.includes('createRecord') ? json({ error: 'InvalidRecord' }, false) : happyRoute(url)),
    () => bskyPost('h', 'p', TEXT, NO_WAIT),
  );
  assert.match(post.result.error.message, /^Bluesky post failed: .*InvalidRecord/);
  assert.equal(count(post.calls, 'createRecord'), 1);
});

test('falls back to bsky.social when the session has no PDS, and uploads the og:image as a thumbnail', async () => {
  const { result, calls } = await withFetch((url) => {
    if (url.includes('createSession')) return json({ did: 'did:plc:x', accessJwt: 'jwt' });
    if (url.includes('uploadBlob')) return json({ blob: { ref: 'b' } });
    if (url.includes('cover.jpg')) return { ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(1) };
    if (url.includes('createRecord')) return json({ uri: 'at://x/1' });
    return { ok: true, text: async () => '<meta property="og:image" content="https://img.test/cover.jpg">' };
  }, () => bskyPost('h', 'p', TEXT, NO_WAIT));
  assert.equal(result.value.uri, 'at://x/1');
  assert.equal(count(calls, 'https://bsky.social/xrpc/com.atproto.repo.uploadBlob'), 1);
  assert.equal(count(calls, 'https://bsky.social/xrpc/com.atproto.repo.createRecord'), 1);
});
