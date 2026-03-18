#!/usr/bin/env node
/**
 * Posts a random approved, unsent clip from clips.yaml to Bluesky.
 *
 * Usage:
 *   node scripts/post-clip.mjs            # post for real
 *   node scripts/post-clip.mjs --dry-run  # preview without posting
 *
 * Required env vars:
 *   BLUESKY_HANDLE        your handle, e.g. jadethree.bsky.social
 *   BLUESKY_APP_PASSWORD  app password from Settings → Privacy → App Passwords
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIPS_FILE = path.join(ROOT, 'clips.yaml');
const BSKY_API = 'https://bsky.social/xrpc';

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');
const BSKY_HEADERS = { 'User-Agent': 'jade-three-bot/1.0' };

// ── Clip loading ──────────────────────────────────────────────────────────────

function loadEligibleClips() {
  const raw = fs.readFileSync(CLIPS_FILE, 'utf-8');
  const songs = yaml.load(raw);

  const eligible = [];
  for (const song of songs) {
    for (const clip of song.clips ?? []) {
      if (clip.approved === true && clip.sent === false) {
        eligible.push({ slug: song.slug, text: clip.text.trim() });
      }
    }
  }
  return eligible;
}

// ── File update ───────────────────────────────────────────────────────────────

function markSent(clipText) {
  const content = fs.readFileSync(CLIPS_FILE, 'utf-8');

  // Find the clip by its first line (indented 8 spaces in the file)
  const firstLine = clipText.split('\n')[0];
  const idx = content.indexOf(`        ${firstLine}`);
  if (idx === -1) throw new Error(`Could not locate clip in file:\n  ${firstLine}`);

  // Walk back to find the nearest "sent: false" before this position
  const marker = '      sent: false';
  const markerIdx = content.lastIndexOf(marker, idx);
  if (markerIdx === -1) throw new Error('Could not find sent: false for this clip');

  const updated =
    content.slice(0, markerIdx) +
    '      sent: true' +
    content.slice(markerIdx + marker.length);

  fs.writeFileSync(CLIPS_FILE, updated);
}

// ── Bluesky ───────────────────────────────────────────────────────────────────

// Fetch OG title/description/image from a URL
async function fetchOgData(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Bluesky/cardyb' } });
  const html = await res.text();
  const get = (prop) =>
    html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]+)"`))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="${prop}"`))?.[1];
  return {
    title: get('og:title') ?? url,
    description: get('og:description') ?? '',
    imageUrl: get('og:image'),
  };
}

// Download an image and upload it as a Bluesky blob
async function uploadThumb(imageUrl, accessJwt, pdsApi) {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
    const body = await res.arrayBuffer();
    const uploadRes = await fetch(`${pdsApi}/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: { 'Content-Type': mimeType, Authorization: `Bearer ${accessJwt}`, ...BSKY_HEADERS },
      body,
    });
    if (!uploadRes.ok) return null;
    return (await uploadRes.json()).blob;
  } catch {
    return null;
  }
}

async function bskyPost(handle, password, text) {
  // 1. Authenticate
  const authRes = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...BSKY_HEADERS },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!authRes.ok) {
    const err = await authRes.text();
    throw new Error(`Bluesky auth failed: ${err}`);
  }
  const { did, accessJwt, didDoc } = await authRes.json();

  // Resolve the PDS URL from the DID document (accounts may be on a different PDS than bsky.social)
  const pdsUrl =
    didDoc?.service?.find(s => s.id === '#atproto_pds')?.serviceEndpoint ?? 'https://bsky.social';
  const pdsApi = `${pdsUrl}/xrpc`;
  process.stderr.write(`PDS: ${pdsUrl}\n`);

  // 2. Detect URL facets (so the link in the post text is clickable)
  const facets = detectUrlFacets(text);

  // 3. Build link card embed from the release page's OG tags
  const postUrl = text.split('\n').filter(Boolean).at(-1).trim();
  process.stderr.write(`Fetching OG data for: ${postUrl}\n`);
  const og = await fetchOgData(postUrl);
  const thumb = og.imageUrl ? await uploadThumb(og.imageUrl, accessJwt, pdsApi) : null;
  if (!thumb) process.stderr.write('  (no thumbnail — image unavailable)\n');

  const embed = {
    $type: 'app.bsky.embed.external',
    external: {
      uri: postUrl,
      title: og.title,
      description: og.description,
      ...(thumb && { thumb }),
    },
  };

  // 4. Create the post
  const postRes = await fetch(`${pdsApi}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessJwt}`,
      ...BSKY_HEADERS,
    },
    body: JSON.stringify({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        ...(facets.length > 0 && { facets }),
        embed,
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!postRes.ok) {
    const err = await postRes.text();
    throw new Error(`Bluesky post failed: ${err}`);
  }
  return postRes.json();
}

// Bluesky facets use UTF-8 byte offsets
function detectUrlFacets(text) {
  const enc = new TextEncoder();
  const urlRe = /https?:\/\/[^\s]+/g;
  const facets = [];
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const byteStart = enc.encode(text.slice(0, match.index)).length;
    const byteEnd = byteStart + enc.encode(match[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }
  return facets;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const eligible = loadEligibleClips();

  if (eligible.length === 0) {
    console.log('No approved, unsent clips available.');
    process.exit(0);
  }

  const clip = eligible[Math.floor(Math.random() * eligible.length)];

  console.log(`Song:   ${clip.slug}`);
  console.log(`Length: ${clip.text.length} chars`);
  console.log('─'.repeat(50));
  console.log(clip.text);
  console.log('─'.repeat(50));

  if (DRY_RUN) {
    console.log('\n[Dry run] Not posting. Exiting.');
    return;
  }

  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!handle || !password) {
    console.error('Error: BLUESKY_HANDLE and BLUESKY_APP_PASSWORD must be set.');
    process.exit(1);
  }

  const result = await bskyPost(handle, password, clip.text);
  console.log(`\nPosted! ${result.uri}`);

  markSent(clip.text);
  console.log('clips.yaml updated: marked as sent.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
