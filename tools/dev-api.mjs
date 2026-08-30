#!/usr/bin/env node
// @ts-check

/**
 * dev-api.mjs — runs the REAL Worker locally, over the same
 * node:sqlite-backed bindings the tests use.
 *
 * This machine has no Cloudflare account and `wrangler dev` wants a
 * D1 id, so this is how the capture app is exercised end to end
 * without one. It is a development convenience, not a deployment
 * target: production is `wrangler deploy`, and the code under test
 * here is byte-for-byte the code that ships.
 *
 * Usage: node tools/dev-api.mjs [--port 8787] [--load]
 *   --load  check the M0 dataset still loads cleanly
 *   --demo  seed a few review-queue items so the screen has work in it
 */

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { makeEnv } from './test/helpers/bindings.mjs';
import { createApp } from '../worker/index.ts';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const port = Number(argOf('--port', '8787'));

const env = makeEnv();
if (args.includes('--load')) {
  const { loadDataset } = await import('./load-dataset.mjs');
  const { stats } = loadDataset(':memory:');
  console.log(`dev-api: (dataset shape check) ${JSON.stringify(stats.items)} rows load cleanly`);
}
if (args.includes('--demo')) {
  // A handful of realistic review items: one refused for a single
  // signal family, one for a near-tie, one with nothing found.
  const db = env.DB.raw;
  db.exec(`
    INSERT INTO item (crate, position) VALUES ('B4','12'),('B4','13'),('C1','4');
    INSERT INTO capture (item_id, catno_raw, label_raw, title_raw, name_raw) VALUES
      (1, 'SXL 6113', 'Decca', 'Symphony No. 5', 'Solti'),
      (2, 'CFP 40001', NULL, 'Beethoven Symphony No. 4', 'Cluytens'),
      (3, 'RD ?', NULL, 'Unknown', NULL);
    INSERT INTO match_run (item_id, state, queries_json) VALUES
      (1, 'needs-review', '{"reason":"only 1 signal family (identifier) — a catalogue number alone is a lead, not a verdict"}'),
      (2, 'needs-review', '{"reason":"margin 4 < 25 over the runner-up"}'),
      (3, 'needs-review', '{"reason":"not searchable: contains a question mark — uncertain input"}');
    INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json) VALUES
      (1, 1, 1451234, 73, '{"families":["identifier"],"signals":{"identifier":"exact catno SXL 6113"}}'),
      (1, 2, 2298871, 23, '{"families":["label"],"signals":{"label":"decca"}}'),
      (2, 1, 3310022, 88, '{"families":["identifier","title"],"signals":{"identifier":"exact catno CFP 40001","title":"3/4 title words"}}'),
      (2, 2, 3310099, 84, '{"families":["identifier","title"],"signals":{"identifier":"exact catno CFP 40001","title":"3/4 title words"}}');
  `);
  console.log('dev-api: seeded 3 review-queue items');
}

const app = createApp();

createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers: /** @type {any} */ (req.headers),
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  });

  try {
    const response = await app.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
    console.log(`${req.method} ${req.url} -> ${response.status}`);
  } catch (err) {
    console.error('dev-api error', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
}).listen(port, () => console.log(`dev-api: real Worker on http://127.0.0.1:${port} (in-memory D1)`));
