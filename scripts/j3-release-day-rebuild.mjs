#!/usr/bin/env node
/**
 * j3-release-day-rebuild.mjs
 * Upcoming releases stay off the site until a build runs on their release date
 * (see src/lib/release-dates.js). This triggers that build: when a release has
 * gone live since the last check, it POSTs to the Netlify build hook. On other
 * days it does nothing, so it costs one Netlify build per release.
 *
 * Usage:
 *   node scripts/j3-release-day-rebuild.mjs [--dry-run] [--today YYYY-MM-DD]
 *
 * Needs NETLIFY_BUILD_HOOK (Netlify → Site configuration → Build & deploy →
 * Build hooks). It fails when a release is due or upcoming and the hook isn't
 * set, so a missing hook shows up before release day rather than on it.
 * Netlify builds what's pushed to main, so push the release before its date.
 *
 * The last day checked is kept in scripts/j3-release-day-rebuild.state, so a day the
 * Mac was off is caught up on the next run.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dayBefore, releasedSince, siteToday, unreleasedIds } from '../src/lib/release-dates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES_FILE = join(ROOT, 'src', 'data', 'releases.json');
const STATE_FILE = process.env.RELEASE_REBUILD_STATE ?? join(ROOT, 'scripts', 'j3-release-day-rebuild.state');

/**
 * What to do today.
 * @returns {{ action: 'build' | 'missing-hook' | 'nothing', due: { title: string }[] }}
 */
export function plan(releases, lastChecked, today, hasHook) {
  const due = releasedSince(releases, lastChecked, today);
  const pending = due.length > 0 || unreleasedIds(releases, today).size > 0;
  if (pending && !hasHook) return { action: 'missing-hook', due };
  return { action: due.length > 0 ? 'build' : 'nothing', due };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(args) {
  const dryRun = args.includes('--dry-run');
  const today = argValue(args, '--today') ?? siteToday();
  const lastChecked = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, 'utf-8').trim() : dayBefore(today);
  const { releases } = JSON.parse(readFileSync(RELEASES_FILE, 'utf-8'));
  const hook = process.env.NETLIFY_BUILD_HOOK;

  const { action, due } = plan(releases, lastChecked, today, Boolean(hook));
  const titles = due.map((r) => r.title).join(', ');
  if (action === 'missing-hook') {
    throw new Error('NETLIFY_BUILD_HOOK is not set, so upcoming releases will not go live on their date');
  }
  if (action === 'build') {
    console.log(`Released since ${lastChecked}: ${titles}`);
    if (dryRun) {
      console.log('[Dry run] Not triggering a build.');
      return;
    }
    const res = await fetch(hook, { method: 'POST' });
    if (!res.ok) throw new Error(`Netlify build hook returned ${res.status}`);
    console.log('Triggered a Netlify build.');
  } else {
    console.log(`Nothing released since ${lastChecked}.`);
  }
  if (!dryRun) writeFileSync(STATE_FILE, `${today}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
