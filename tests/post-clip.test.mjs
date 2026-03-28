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
