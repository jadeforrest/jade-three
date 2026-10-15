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

// Load .env from project root if present (without requiring dotenv)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^(?:export\s+)?([A-Za-z_]\w*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
const SONGS_DIR = path.join(ROOT, 'src/content/songs');
const OUTPUT_FILE = path.join(ROOT, 'clips.yaml');
const BASE_URL = 'https://jadethreemusic.com/releases';

let _client;
function client() {
  return (_client ??= new Anthropic());
}

async function generateClips(content, url) {
  const maxTextLen = 300 - url.length - 2; // -2 for the "\n\n" before the URL

  const message = await client().messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 4096,
    // Sonnet 5.5 thinks by default and defaults to high effort. Clip writing
    // doesn't need the depth, so keep the spend near the old no-thinking cost.
    output_config: { effort: 'low' },
    system: 'You write social media posts. Return only the requested clips — no preamble, no commentary, no numbering.',
    messages: [{
      role: 'user',
      content: `Generate as many social media clips as you can for musician Jade Three based on this song interview. Aim for variety — different angles, different moments from the interview.

Requirements:
- Clip text must be ≤${maxTextLen} characters (the full post appends a blank line + the URL, which must stay under 300 chars total)
- Mix first-person clips (using Jade Three's own voice from the interview) and third-person clips
- Jade Three's pronouns are he/him — use them in third-person clips
- Light editing is fine — keep the authentic voice, just sharpen for social media
- About 1 in 4 clips should end with a short engagement question (e.g. "What do you think?", "Give it a listen — what stands out to you?", "What does this one make you feel?"). Vary the questions; don't use the same one twice.
- Separate each clip with "---" on its own line
- Return ONLY the clips, nothing else

Song URL (will be appended to every post): ${url}

Interview content:
${content}`,
    }],
  });

  const clips = parseClips(message.content, url);

  const { kept, warnings } = validateClips(clips, url, message.stop_reason);
  for (const w of warnings) process.stderr.write(`  ${w}\n`);

  return kept;
}

// ── Response parsing ─────────────────────────────────────────────────────────

/**
 * Pull the clip texts out of a Messages API response body.
 *
 * `content` is a union of block types, and Sonnet 5.5 thinks by default, so the
 * text is not reliably `content[0]` — a thinking block can come first. A
 * response carrying no text block at all (a refusal, for instance) yields no
 * clips rather than throwing.
 *
 * @param {Array<{type: string, text?: string}>} content  response content blocks
 * @param {string} url  the song URL, stripped when the model appends it anyway
 * @returns {string[]} clip texts, trimmed, in order, with empties removed
 */
export function parseClips(content, url) {
  const raw = ((content ?? []).find(b => b.type === 'text')?.text ?? '').trim();
  // Escape the URL before it becomes a regex — it is interpolated, not literal.
  const trailingUrl = new RegExp(`\\s*${url.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}\\s*$`);

  return raw
    .split(/^---\s*$/m)
    .map(c => c.trim().replace(trailingUrl, '').trim())
    .filter(Boolean);
}

// ── Validation ───────────────────────────────────────────────────────────────

// A clip is only usable if it reads as a finished thought. Anything else is a
// generation artifact, not a draft worth reviewing.
const TERMINAL_PUNCTUATION = /[.!?…](["'”’)\]]*)$/;

/**
 * Filter a generated batch down to the clips worth writing out.
 *
 * Drops clips that end mid-sentence — a truncated clip is never salvageable by
 * a reviewer skimming clips.yaml, and one slipped through into the La Mítica
 * batch when max_tokens cut off the final clip.
 *
 * Over-budget clips are kept and warned about: they're still readable and the
 * reviewer can trim them.
 *
 * @param {string[]} clips    raw clip texts, URL already stripped
 * @param {string}   url      the URL appended to every post
 * @param {string}   [stopReason] the API stop_reason, if known ('max_tokens'
 *                                and 'refusal' each add their own warning)
 * @returns {{ kept: string[], warnings: string[] }}
 */
export function validateClips(clips, url, stopReason) {
  const kept = [];
  const warnings = [];

  if (stopReason === 'max_tokens') {
    warnings.push('⚠ Response hit max_tokens — the final clip was likely cut off.');
  }

  // A refusal returns HTTP 200 with no text, which otherwise reads as a song
  // that simply produced nothing. Say so instead.
  if (stopReason === 'refusal') {
    warnings.push('⚠ The model declined this song — no clips generated.');
  }

  for (const clip of clips) {
    const preview = clip.slice(0, 60);

    if (!TERMINAL_PUNCTUATION.test(clip)) {
      warnings.push(`⚠ Dropped clip ending mid-sentence: …${clip.slice(-40)}`);
      continue;
    }

    const full = `${clip}\n\n${url}`;
    if (full.length > 300) {
      warnings.push(`⚠ Clip over 300 chars (${full.length}), kept for trimming: ${preview}…`);
    }

    kept.push(clip);
  }

  const dropped = clips.length - kept.length;
  if (dropped > 0) {
    warnings.push(`⚠ ${dropped} of ${clips.length} clip(s) dropped as unusable.`);
  }

  return { kept, warnings };
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

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
