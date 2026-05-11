import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createLogger } from '../server/logger.js';
import { createRouter, createStaticServer } from '../server/router-core.js';

function silentLogger() {
  const stream = { write() {} };
  return createLogger({ stdout: stream, stderr: stream });
}

async function withServer(routes, fn, { webRoot } = {}) {
  const server = createServer(createRouter(routes, {
    staticServer: createStaticServer({ webRoot }),
    logger: silentLogger()
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('dispatches exact method and path and attaches request id', async () => {
  await withServer([
    {
      method: 'POST',
      path: '/api/example',
      async handler(req, res) {
        res.json({ ok: true, reqId: req.reqId });
      }
    }
  ], async (base) => {
    const response = await fetch(`${base}/api/example`, { method: 'POST' });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-request-id'), /^req-/);
    assert.match(data.reqId, /^req-/);
  });
});

test('returns 405 with allow header on method mismatch', async () => {
  await withServer([
    { method: 'GET', path: '/api/items', async handler(req, res) { res.json({ ok: true }); } },
    { method: 'POST', path: '/api/items', async handler(req, res) { res.json({ ok: true }); } }
  ], async (base) => {
    const response = await fetch(`${base}/api/items`, { method: 'DELETE' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, POST');
    assert.deepEqual(await response.json(), { error: 'Method not allowed' });
  });
});

test('falls back to static files and returns text 404 when missing', async () => {
  const webRoot = mkdtempSync(join(tmpdir(), 'claudio-web-'));
  writeFileSync(join(webRoot, 'index.html'), '<h1>Claudio</h1>');
  await withServer([], async (base) => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.match(await index.text(), /Claudio/);

    const missing = await fetch(`${base}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await missing.text(), 'Not found');
  }, { webRoot });
});

test('parses json body and treats invalid json as empty object', async () => {
  await withServer([
    {
      method: 'POST',
      path: '/api/body',
      async handler(req, res) {
        res.json(await req.body());
      }
    }
  ], async (base) => {
    const valid = await fetch(`${base}/api/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    });
    assert.deepEqual(await valid.json(), { hello: 'world' });

    const invalid = await fetch(`${base}/api/body`, { method: 'POST', body: '{nope' });
    assert.deepEqual(await invalid.json(), {});
  });
});

test('rejects oversized payloads with 413', async () => {
  await withServer([
    {
      method: 'POST',
      path: '/api/body',
      async handler(req, res) {
        await req.body();
        res.json({ ok: true });
      }
    }
  ], async (base) => {
    const response = await fetch(`${base}/api/body`, {
      method: 'POST',
      body: 'x'.repeat(1_000_001)
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Payload too large' });
  });
});

test('returns json 500 when a handler throws', async () => {
  await withServer([
    {
      method: 'GET',
      path: '/api/fail',
      async handler() {
        throw new Error('boom');
      }
    }
  ], async (base) => {
    const response = await fetch(`${base}/api/fail`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'boom' });
  });
});
