#!/usr/bin/env node
/**
 * Generates social media clips for each song in src/content/songs.
 * Output: clips.yaml in the project root.
 *
 * Usage:
 *   node scripts/generate-clips.mjs              # all songs
 *   node scripts/generate-clips.mjs stinger      # one song by slug
 *
 * Re-running skips songs that already have clips in clips.yaml (by slug).
 * To regenerate a song, delete its entry from clips.yaml first.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SONGS_DIR = path.join(ROOT, 'src/content/songs');
const OUTPUT_FILE = path.join(ROOT, 'clips.yaml');
const BASE_URL = 'https://jadethreemusic.com/releases';

const client = new Anthropic();

async function generateClips(content, url) {
  const maxTextLen = 300 - url.length - 2; // -2 for the "\n\n" before the URL

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: 'You write social media posts. Return only the requested clips — no preamble, no commentary, no numbering.',
    messages: [{
      role: 'user',
      content: `Generate as many social media clips as you can for musician Jade Three based on this song interview. Aim for variety — different angles, different moments from the interview.

Requirements:
- Clip text must be ≤${maxTextLen} characters (the full post appends a blank line + the URL, which must stay under 300 chars total)
- Mix first-person clips (using Jade Three's own voice from the interview) and third-person clips
- Jade Three's pronouns are he/him — use them in third-person clips
- Light editing is fine — keep the authentic voice, just sharpen for social media
- Separate each clip with "---" on its own line
- Return ONLY the clips, nothing else

Song URL (will be appended to every post): ${url}

Interview content:
${content}`,
    }],
  });

  const raw = message.content[0].text.trim();
  const clips = raw
    .split(/^---\s*$/m)
    .map(c => {
      // Claude sometimes appends the URL despite being told not to — strip it
      return c.trim().replace(new RegExp(`\\s*${url.replace(/\//g, '\\/')}\\s*$`), '').trim();
    })
    .filter(Boolean);

  // Warn if any clip is over budget
  for (const clip of clips) {
    const full = clip + '\n\n' + url;
    if (full.length > 300) {
      process.stderr.write(`  ⚠ Clip over 300 chars (${full.length}): ${clip.slice(0, 60)}…\n`);
    }
  }

  return clips;
}

// ── YAML builder ──────────────────────────────────────────────────────────────

function yamlHeader() {
  return [
    '# Social media clips for Jade Three',
    '# approved: change false → true for clips you want to post',
    '# sent:     change false → true after posting',
    '',
  ].join('\n');
}

function songBlock(slug, url, clips) {
  const lines = [
    `- slug: ${slug}`,
    `  url: ${url}`,
    `  clips:`,
  ];

  for (const clip of clips) {
    // Indent every line of the clip text to 8 spaces (YAML literal block scalar)
    const indented = clip.split('\n').map(l => `        ${l}`).join('\n');
    lines.push(`    - approved: false`);
    lines.push(`      sent: false`);
    lines.push(`      text: |`);
    lines.push(indented);
    lines.push('');              // blank line within block scalar (paragraph break)
    lines.push(`        ${url}`);
    lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}

// ── Idempotency: find slugs already in the output file ───────────────────────

function existingSlugs(outputPath) {
  if (!fs.existsSync(outputPath)) return new Set();
  const content = fs.readFileSync(outputPath, 'utf-8');
  const matches = content.matchAll(/^- slug: (.+)$/gm);
  return new Set([...matches].map(m => m[1].trim()));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const filter = process.argv[2]; // optional slug, e.g. "stinger"

  let files = fs.readdirSync(SONGS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (filter) {
    const match = files.find(f => path.basename(f, '.md') === filter);
    if (!match) {
      console.error(`No song file found for slug: ${filter}`);
      console.error(`Available slugs:\n  ${files.map(f => path.basename(f, '.md')).join('\n  ')}`);
      process.exit(1);
    }
    files = [match];
  }

  const done = existingSlugs(OUTPUT_FILE);

  // If starting fresh, write the header
  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.writeFileSync(OUTPUT_FILE, yamlHeader());
  }

  let wrote = 0;

  for (const file of files) {
    const slug = path.basename(file, '.md');

    if (done.has(slug)) {
      process.stderr.write(`Skipping ${slug} (already exists)\n`);
      continue;
    }

    const url = `${BASE_URL}/${slug}`;
    const content = fs.readFileSync(path.join(SONGS_DIR, file), 'utf-8');

    process.stderr.write(`Generating clips for: ${slug}...\n`);

    const clips = await generateClips(content, url);
    fs.appendFileSync(OUTPUT_FILE, songBlock(slug, url, clips));
    wrote++;
  }

  if (wrote === 0) {
    process.stderr.write('\nAll songs already have clips. Delete entries from clips.yaml to regenerate.\n');
  } else {
    process.stderr.write(`\nDone — ${wrote} song(s) written to clips.yaml\n`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
