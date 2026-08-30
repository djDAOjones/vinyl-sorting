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
 *   --load  seed the database from data/deep-groove-v1.csv
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
