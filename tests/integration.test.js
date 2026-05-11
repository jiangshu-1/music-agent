import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CLAUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), 'claudio-data-'));
process.env.HOST = '127.0.0.1';
process.env.LOG_LEVEL = 'error';

test('boots server on an ephemeral port and serves core endpoints', async () => {
  const { createAppServer } = await import('../server/index.js');
  const { server, wss } = createAppServer({ startBackgroundJobs: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    for (const path of ['/api/now', '/api/stations', '/api/queue', '/api/health', '/api/search?q=focus']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('x-request-id'));
      await response.json();
    }
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
