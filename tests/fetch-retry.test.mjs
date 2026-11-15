/**
 * Unit + property tests for scripts/lib/fetch-retry.mjs
 * Run with: node --test tests/fetch-retry.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { fetchWithRetry, describeFetchError, DEFAULT_DELAYS_MS } from '../scripts/lib/fetch-retry.mjs';

const URL_ = 'https://bsky.social/xrpc/com.atproto.server.createSession';

/** What Node's fetch throws when the network is down. */
function networkError(code = 'ENOTFOUND', hostname = 'bsky.social') {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code}`), { code, hostname }) });
}

/** A fetch that throws `failures` times, then resolves; records calls, sleeps and log lines. */
function harness(failures, response = { ok: true, status: 200 }) {
  const calls = [];
  const sleeps = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length <= failures) throw networkError();
    return response;
  };
  const opts = (delaysMs) => ({ delaysMs, fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, log: (l) => logs.push(l) });
  return { calls, sleeps, logs, opts };
}

test('regression: a network failure on the first attempt is retried and then succeeds', async () => {
  const h = harness(1);
  const init = { method: 'POST' };
  const res = await fetchWithRetry(URL_, init, h.opts([5, 15]));
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1], { url: URL_, init });
  assert.deepEqual(h.sleeps, [5]);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /bsky\.social: fetch failed \(ENOTFOUND bsky\.social\); retrying in 0\.005s/);
});

test('gives up after the last delay with an error naming host, attempts and cause', async () => {
  const h = harness(Infinity);
  await assert.rejects(fetchWithRetry(URL_, undefined, h.opts([1, 2])), (err) => {
    assert.equal(err.message, 'Network error reaching bsky.social after 3 attempt(s): fetch failed (ENOTFOUND bsky.social)');
    assert.equal(err.cause.message, 'fetch failed');
    return true;
  });
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.sleeps, [1, 2]);
});

test('an HTTP error response is returned, not retried', async () => {
  const h = harness(0, { ok: false, status: 503 });
  const res = await fetchWithRetry(URL_, undefined, h.opts([1, 2]));
  assert.equal(res.status, 503);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test('no delays means a single attempt', async () => {
  const h = harness(1);
  await assert.rejects(fetchWithRetry(URL_, undefined, h.opts([])), /after 1 attempt\(s\)/);
  assert.equal(h.calls.length, 1);
});

test('defaults: three retries, real fetch and stderr logging are wired in', async () => {
  assert.deepEqual(DEFAULT_DELAYS_MS, [5_000, 15_000, 30_000]);
  const origFetch = globalThis.fetch;
  const origWrite = process.stderr.write;
  const written = [];
  let n = 0;
  globalThis.fetch = async () => {
    if (n++ === 0) throw networkError();
    return { status: 204 };
  };
  process.stderr.write = (s) => { written.push(s); return true; };
  try {
    const res = await fetchWithRetry(URL_, undefined, { delaysMs: [1] }); // real 1ms sleep
    assert.equal(res.status, 204);
  } finally {
    globalThis.fetch = origFetch;
    process.stderr.write = origWrite;
  }
  assert.equal(n, 2);
  assert.equal(written.length, 1);
  assert.match(written[0], /retrying in 0\.001s\n$/);
});

test('describeFetchError covers code+host, code only, cause message, and no cause', () => {
  assert.equal(describeFetchError(networkError('ETIMEDOUT', 'x.test')), 'fetch failed (ETIMEDOUT x.test)');
  assert.equal(describeFetchError(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })), 'fetch failed (ECONNRESET)');
  assert.equal(describeFetchError(new TypeError('fetch failed', { cause: new Error('socket hang up') })), 'fetch failed (socket hang up)');
  assert.equal(describeFetchError(new Error('boom')), 'boom');
  assert.equal(describeFetchError('plain string'), 'plain string');
  assert.equal(describeFetchError(undefined), 'undefined');
});

test('property: succeeds iff failures <= retries; calls and sleeps match exactly', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 60_000 }), { maxLength: 6 }),
      fc.integer({ min: 0, max: 8 }),
      async (delaysMs, failures) => {
        const h = harness(failures);
        const outcome = await fetchWithRetry(URL_, undefined, h.opts(delaysMs)).then(
          () => 'ok',
          () => 'threw',
        );
        const retries = delaysMs.length;
        assert.equal(outcome, failures <= retries ? 'ok' : 'threw');
        assert.equal(h.calls.length, Math.min(failures, retries) + 1);
        assert.deepEqual(h.sleeps, delaysMs.slice(0, Math.min(failures, retries)));
        assert.equal(h.logs.length, h.sleeps.length);
      },
    ),
    { numRuns: 300 },
  );
});
