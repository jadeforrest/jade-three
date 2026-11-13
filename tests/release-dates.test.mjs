/**
 * Unit + property tests for src/lib/release-dates.js and the scripts that use it.
 * Run with: node --test tests/release-dates.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fc from 'fast-check';
import { isReleased, siteToday, unreleasedIds } from '../src/lib/release-dates.js';
import { keepUnlistedUpcoming } from '../scripts/fetch-releases.js';

const date = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const release = fc.record({ id: fc.uuid(), title: fc.string(), releaseDate: date });

test('siteToday uses Portland time, not UTC', () => {
  // 3 AM UTC on Dec 1 is still Nov 30 in Portland (PST, UTC-8).
  assert.equal(siteToday(new Date('2026-12-01T03:00:00Z')), '2026-11-30');
  assert.equal(siteToday(new Date('2026-12-01T08:00:00Z')), '2026-12-01');
  // During daylight time the change is at 07:00 UTC.
  assert.equal(siteToday(new Date('2026-07-01T06:59:00Z')), '2026-06-30');
  assert.equal(siteToday(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
});

test('siteToday always returns YYYY-MM-DD', () => {
  fc.assert(
    fc.property(fc.date({ noInvalidDate: true, min: new Date(0), max: new Date('2200-01-01') }), (d) => {
      assert.match(siteToday(d), /^\d{4}-\d{2}-\d{2}$/);
    }),
  );
});

test('a release is out on its release date, not the day before', () => {
  assert.equal(isReleased('2026-12-01', '2026-11-30'), false);
  assert.equal(isReleased('2026-12-01', '2026-12-01'), true);
  assert.equal(isReleased('2026-12-01', '2026-12-02'), true);
});

test('isReleased agrees with comparing the dates as times', () => {
  fc.assert(
    fc.property(date, date, (releaseDate, today) => {
      assert.equal(isReleased(releaseDate, today), Date.parse(releaseDate) <= Date.parse(today));
    }),
  );
});

test('unreleasedIds holds exactly the releases dated after today', () => {
  fc.assert(
    fc.property(fc.uniqueArray(release, { selector: (r) => r.id }), date, (releases, today) => {
      const hidden = unreleasedIds(releases, today);
      for (const r of releases) assert.equal(hidden.has(r.id), r.releaseDate > today);
    }),
  );
});

test('a sync keeps a hand-added upcoming release iTunes does not list yet', () => {
  const upcoming = { id: 'single-new', title: 'Unincorporated', releaseDate: '2026-12-01' };
  const old = { id: 'single-old', title: 'Stinger', releaseDate: '2025-01-04' };
  assert.deepEqual(keepUnlistedUpcoming([old], [old, upcoming], '2026-11-12'), [upcoming]);
});

test('a sync drops the hand-added entry once iTunes lists the release', () => {
  const upcoming = { id: 'single-new', title: 'Unincorporated', releaseDate: '2026-12-01' };
  const listed = { id: 'single-123', title: 'Unincorporated - Single', releaseDate: '2026-12-01' };
  assert.deepEqual(keepUnlistedUpcoming([listed], [upcoming], '2026-11-12'), []);
});

test('a sync does not resurrect past releases iTunes stopped listing', () => {
  fc.assert(
    fc.property(fc.array(release), fc.array(release), date, (fetched, existing, today) => {
      for (const kept of keepUnlistedUpcoming(fetched, existing, today)) {
        assert.ok(existing.includes(kept));
        assert.ok(kept.releaseDate > today);
      }
    }),
  );
});

const POST_CLIP = new URL('../scripts/post-clip.mjs', import.meta.url).pathname;
const postClip = (...args) => execFileSync('node', [POST_CLIP, '--dry-run', ...args], { encoding: 'utf-8' });

test('post-clip skips clips for a song whose release date has not arrived', () => {
  // Fall in Love has approved, unsent clips (post-clip.test.mjs relies on it).
  assert.match(postClip('--slug', 'fall-in-love', '--today', '2000-01-01'), /No approved, unsent clips available/);
  assert.match(postClip('--slug', 'fall-in-love', '--today', '2099-01-01'), /Song:\s+fall-in-love/);
});

import { dayBefore, releasedSince } from '../src/lib/release-dates.js';
import { plan } from '../scripts/j3-release-day-rebuild.mjs';

/** [lastChecked, today] with lastChecked on or before today. */
const checkWindow = fc.tuple(date, date).map(([a, b]) => (a <= b ? [a, b] : [b, a]));

test('dayBefore crosses month, year and leap-day boundaries', () => {
  assert.equal(dayBefore('2026-12-01'), '2026-11-30');
  assert.equal(dayBefore('2027-01-01'), '2026-12-31');
  assert.equal(dayBefore('2028-03-01'), '2028-02-29');
});

test('dayBefore is always exactly one calendar day earlier', () => {
  fc.assert(
    fc.property(date, (d) => {
      assert.equal(Date.parse(d) - Date.parse(dayBefore(d)), 86_400_000);
    }),
  );
});

test('releasedSince picks releases after the last check, up to and including today', () => {
  fc.assert(
    fc.property(fc.array(release), checkWindow, (releases, [lastChecked, today]) => {
      const due = releasedSince(releases, lastChecked, today);
      for (const r of releases) {
        assert.equal(due.includes(r), r.releaseDate > lastChecked && r.releaseDate <= today);
      }
    }),
  );
});

const upcoming = { id: 'u', title: 'Unincorporated', releaseDate: '2026-12-01' };
const past = { id: 'p', title: 'Stinger', releaseDate: '2025-01-04' };

test('the rebuild job builds on release day', () => {
  assert.deepEqual(plan([past, upcoming], '2026-11-30', '2026-12-01', true), { action: 'build', due: [upcoming] });
});

test('the rebuild job catches up a release day the Mac missed', () => {
  assert.equal(plan([upcoming], '2026-11-28', '2026-12-03', true).action, 'build');
});

test('the rebuild job does nothing on other days', () => {
  assert.equal(plan([past, upcoming], '2026-11-12', '2026-11-13', true).action, 'nothing');
  assert.equal(plan([past, upcoming], '2026-12-01', '2026-12-02', true).action, 'nothing');
});

test('the rebuild job fails early when a release is upcoming and no hook is set', () => {
  assert.equal(plan([past, upcoming], '2026-11-12', '2026-11-13', false).action, 'missing-hook');
  assert.equal(plan([past, upcoming], '2026-11-30', '2026-12-01', false).action, 'missing-hook');
});

test('the rebuild job stays quiet without a hook when nothing is upcoming', () => {
  assert.equal(plan([past], '2026-11-12', '2026-11-13', false).action, 'nothing');
});

test('the rebuild job builds exactly when something went live, given a hook', () => {
  fc.assert(
    fc.property(fc.array(release), checkWindow, (releases, [lastChecked, today]) => {
      const { action, due } = plan(releases, lastChecked, today, true);
      assert.equal(action === 'build', due.length > 0);
    }),
  );
});

const REBUILD = new URL('../scripts/j3-release-day-rebuild.mjs', import.meta.url).pathname;

/** Runs the rebuild CLI with its state file in a temp dir; returns { code, out, state }. */
async function runRebuild(args, { hook, state } = {}) {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const stateFile = join(mkdtempSync(join(tmpdir(), 'rebuild-')), 'state');
  if (state) writeFileSync(stateFile, `${state}\n`);
  const env = { ...process.env, RELEASE_REBUILD_STATE: stateFile };
  delete env.NETLIFY_BUILD_HOOK;
  if (hook) env.NETLIFY_BUILD_HOOK = hook;
  const child = spawn('node', [REBUILD, ...args], { env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, out, state: existsSync(stateFile) ? readFileSync(stateFile, 'utf-8').trim() : null };
}

/** A stand-in for the Netlify build hook that records POSTs and answers `status`. */
async function fakeHook(status) {
  const { createServer } = await import('node:http');
  const posts = [];
  const server = createServer((req, res) => {
    posts.push(req.method);
    res.writeHead(status).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, posts, close: () => server.close() };
}

// La Mítica is dated 2026-10-15 in releases.json.
test('rebuild CLI POSTs the hook on release day and records the day', async () => {
  const hook = await fakeHook(200);
  try {
    const run = await runRebuild(['--today', '2026-10-15'], { hook: hook.url, state: '2026-10-14' });
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /Released since 2026-10-14: La Mítica/);
    assert.deepEqual(hook.posts, ['POST']);
    assert.equal(run.state, '2026-10-15');
  } finally {
    hook.close();
  }
});

test('rebuild CLI fails and keeps the old state when the hook errors, so it retries', async () => {
  const hook = await fakeHook(500);
  try {
    const run = await runRebuild(['--today', '2026-10-15'], { hook: hook.url, state: '2026-10-14' });
    assert.equal(run.code, 1);
    assert.match(run.out, /returned 500/);
    assert.equal(run.state, '2026-10-14');
  } finally {
    hook.close();
  }
});

test('rebuild CLI dry run reports without posting or saving state', async () => {
  const run = await runRebuild(['--dry-run', '--today', '2026-10-15'], { hook: 'http://127.0.0.1:9/never' });
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /\[Dry run\]/);
  assert.equal(run.state, null);
});

test('rebuild CLI does nothing on an ordinary day and saves it', async () => {
  const run = await runRebuild(['--today', '2099-01-02'], { state: '2099-01-01' });
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /Nothing released since 2099-01-01/);
  assert.equal(run.state, '2099-01-02');
});

test('rebuild CLI fails when a release is upcoming and no hook is set', async () => {
  const run = await runRebuild(['--today', '2026-10-01']);
  assert.equal(run.code, 1);
  assert.match(run.out, /NETLIFY_BUILD_HOOK is not set/);
  assert.equal(run.state, null);
});
