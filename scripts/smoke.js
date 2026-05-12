import { spawnSync } from 'node:child_process';

const base = process.env.CIKE_BASE || process.env.CLAUDIO_BASE || 'http://127.0.0.1:8080';

const checks = [
  {
    name: 'app shell',
    path: '/',
    expect: async (response) => {
      const text = await response.text();
      return response.ok && text.includes('此刻');
    }
  },
  {
    name: 'now playing',
    path: '/api/now',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && Boolean(data.current) && Array.isArray(data.queue);
    }
  },
  {
    name: 'health',
    path: '/api/health',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && data.status !== 'bad' && Array.isArray(data.checks);
    }
  },
  {
    name: 'library stats',
    path: '/api/library/stats',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && Number.isFinite(data.imported) && Number.isFinite(data.missingUrl);
    }
  },
  {
    name: 'stations',
    path: '/api/stations',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && data.stations?.some((station) => station.id === 'focus');
    }
  },
  {
    name: 'tts status',
    path: '/api/tts/status',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && Boolean(data.provider) && Array.isArray(data.styles);
    }
  },
  {
    name: 'netease status',
    path: '/api/netease/status',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && data.configured === true && data.hasCookie === true;
    }
  },
  {
    name: 'backup snapshot',
    path: '/api/backup',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && Boolean(data.exportedAt) && Array.isArray(data.playlists);
    }
  },
  {
    name: 'insights',
    path: '/api/insights?days=7',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && data.totals && Array.isArray(data.topArtists) && Array.isArray(data.hourBuckets);
    }
  },
  {
    name: 'sleep timer',
    path: '/api/sleep-timer',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && ('timer' in data);
    }
  },
  {
    name: 'netease sync status',
    path: '/api/netease/sync/status',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && ('lastSync' in data);
    }
  },
  {
    name: 'ambience',
    path: '/api/ambience?fresh=0',
    expect: async (response) => {
      const data = await response.json();
      return response.ok && ('ambience' in data);
    }
  }
];

async function runCheck(check) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const url = new URL(check.path, base).toString();
      const result = spawnSync('curl', ['--noproxy', '*', '-sS', '--max-time', '10', url], {
        encoding: 'utf8'
      });
      if (result.status !== 0) throw new Error(result.stderr.trim() || `curl exited ${result.status}`);
      const response = {
        ok: true,
        text: async () => result.stdout,
        json: async () => JSON.parse(result.stdout)
      };
      const passed = await check.expect(response);
      if (!passed) throw new Error(`unexpected response for ${check.path}`);
      console.log(`ok ${check.name}`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) spawnSync('sleep', ['0.5']);
    }
  }
  console.error(`fail ${check.name}: ${lastError.message}`);
  return false;
}

let failed = 0;
for (const check of checks) {
  const passed = await runCheck(check);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`smoke failed: ${failed}/${checks.length}`);
  process.exit(1);
}

console.log(`smoke passed: ${checks.length}/${checks.length}`);
