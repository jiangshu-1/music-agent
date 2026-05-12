import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadDotEnv } from './env.js';
import { localAddresses } from './network.js';
import { configureFetchProxy } from './proxy.js';
import { route } from './router.js';
import { startScheduler } from './scheduler.js';
import { setBroadcaster } from './broadcast.js';
import { logger } from './logger.js';

export function createAppServer({ handler = route, startBackgroundJobs = true } = {}) {
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      logger.withTag('server').error('unhandled route error', { error: error.message });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  });

  const wss = new WebSocketServer({ server });

  function broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  setBroadcaster(broadcast);

  server.on('listening', () => {
    if (!startBackgroundJobs) return;
    startScheduler(
      (plan) => {
        broadcast({ type: 'plan', ...plan });
        logger.withTag('server').info('broadcast plan update', { say: plan.say });
      },
      (timer) => {
        broadcast({ type: 'sleep-expired', timer });
        logger.withTag('server').info('sleep timer expired');
      }
    );
  });

  return { server, wss, broadcast };
}

export function startServer({ port = Number(process.env.PORT ?? 8080), host = process.env.HOST ?? '0.0.0.0' } = {}) {
  loadDotEnv();
  configureFetchProxy();
  const app = createAppServer();
  app.server.listen(port, host, () => {
    // Keep startup banner lines human-readable for CLI users.
    console.log(`此刻 is running at http://127.0.0.1:${port}`);
    for (const address of localAddresses(port)) {
      console.log(`LAN access: ${address.url}`);
    }
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
