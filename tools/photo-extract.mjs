#!/usr/bin/env node
// @ts-check

/**
 * photo-extract.mjs — SPIKE-PHOTO-TO-FIELDS, the measuring half.
 *
 * Reads label photographs and asks a vision model what is printed on
 * them, one JSON object per photo. It answers a question; it does not
 * ship a feature.
 *
 * IT NEVER TOUCHES THE DATABASE. Not the schema, not `capture`, not
 * `raw_value`. A spike measures; promoting a reading into the store is
 * a separate decision the measurement is supposed to inform, and a
 * test asserts this file cannot reach sqlite. `capture` in particular
 * is off limits for ever: the hard rule exists so duplicate detection
 * runs on what a person read, not on what a machine guessed.
 *
 * RAW FETCH, NOT THE SDK. The Anthropic SDK would be a new runtime
 * dependency, and the sanctioned exception list in AGENTS.md is closed
 * — hono, typescript, vite, wrangler, workers-types, "Nothing else".
 * So this speaks HTTP directly rather than turning a spike into a
 * stop-and-ask.
 *
 * RESUMABLE BY CONSTRUCTION, like match-run: results are keyed by
 * filename in a file on disk, and a photo already present is skipped.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node tools/photo-extract.mjs \
 *     [--photos data/label-photos] [--out data/photo-extract.json]
 *     [--model claude-opus-5] [--effort low] [--long-edge 1568] [--limit N]
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRequest, costOf } from './lib/photo-fields.mjs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const photoDir = argOf('--photos', 'data/label-photos');
const outPath = argOf('--out', 'data/photo-extract.json');
const model = argOf('--model', 'claude-opus-5');
const effort = argOf('--effort', 'low');
const longEdge = Number(argOf('--long-edge', '1568'));
const limit = Number(argOf('--limit', '0')) || Infinity;

const IMAGE = /^\.(jpe?g|png|webp)$/i;
const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set. It is a credential, so it lives in your');
  console.error('environment and never in the repo. Export it and run again.');
  process.exit(2);
}

if (!existsSync(photoDir)) {
  console.error(`No photo directory at ${photoDir}.`);
  console.error('Photograph ~20 labels, drop them in, and add a ground-truth.csv beside');
  console.error('them (see data/label-photos/README.md) before scoring.');
  process.exit(2);
}

/**
 * Downscale before upload. Above the model's long-edge limit the API
 * downscales anyway, so sending 4032px buys nothing and costs latency;
 * below it, cropping to the label is what keeps the bill in pennies.
 * sips ships with macOS, so this adds no dependency.
 */
function encode(path) {
  const scratch = join(tmpdir(), `dg-${basename(path)}.jpg`);
  execFileSync('sips', ['-Z', String(longEdge), path, '--out', scratch], { stdio: 'ignore' });
  return readFileSync(scratch).toString('base64');
}

/** One call, retrying only what is worth retrying. */
async function extract(base64, mediaType) {
  const body = buildRequest({ model, base64, mediaType, effort });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const call = json.content?.find((b) => b.type === 'tool_use');
      if (!call) throw new Error(`no tool_use block (stop_reason: ${json.stop_reason})`);
      return { fields: call.input, usage: json.usage, stopReason: json.stop_reason };
    }
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    // Honour the server's own backoff rather than inventing one.
    const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
    console.log(`  HTTP ${res.status}, waiting ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error('gave up after 5 attempts');
}

const done = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { model, effort, results: {} };
// A model or effort change invalidates the comparison, so start clean
// rather than silently mixing two runs into one score.
if (done.model !== model || done.effort !== effort) {
  console.log(`Model/effort changed (${done.model}/${done.effort} → ${model}/${effort}); starting a fresh run.`);
  Object.assign(done, { model, effort, results: {} });
}

const photos = readdirSync(photoDir).filter((f) => IMAGE.test(extname(f))).sort();
const todo = photos.filter((f) => !done.results[f]).slice(0, limit);
console.log(`${photos.length} photo(s), ${photos.length - todo.length} already done, ${todo.length} to read.`);

for (const [i, file] of todo.entries()) {
  process.stdout.write(`[${i + 1}/${todo.length}] ${file} … `);
  try {
    const base64 = encode(join(photoDir, file));
    const { fields, usage, stopReason } = await extract(base64, MEDIA[extname(file).toLowerCase()] ?? 'image/jpeg');
    done.results[file] = { fields, usage, stopReason };
    const seen = Object.entries(fields).filter(([, v]) => v !== null && (!Array.isArray(v) || v.length)).length;
    console.log(`${seen} field(s), ${usage.input_tokens} in / ${usage.output_tokens} out`);
  } catch (err) {
    // Record the failure rather than losing the run to it.
    done.results[file] = { error: String(err instanceof Error ? err.message : err) };
    console.log(`FAILED — ${done.results[file].error}`);
  }
  // Written per photo: a run that dies costs the photo it was on.
  mkdirSync(outPath.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(done, null, 2)}\n`);
}

const usages = Object.values(done.results).map((r) => r.usage).filter(Boolean);
const cost = costOf(usages, model);
if (cost) {
  console.log(`\n${cost.photos} photo(s) read on ${model} at effort ${effort}.`);
  console.log(`Spent $${cost.spentUsd.toFixed(4)} — $${cost.perPhotoUsd.toFixed(5)} per photo.`);
  console.log(`All 750: $${cost.collectionUsd.toFixed(2)} (batched, $${cost.collectionBatchedUsd.toFixed(2)}).`);
}
console.log(`\nWrote ${outPath}. Score it with: node tools/photo-score.mjs`);
