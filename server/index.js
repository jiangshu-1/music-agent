import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { loadDotEnv } from './env.js';
import { localAddresses } from './network.js';
import { route } from './router.js';
import { startScheduler } from './scheduler.js';

loadDotEnv();

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
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

server.listen(port, host, () => {
  console.log(`Claudio is running at http://127.0.0.1:${port}`);
  for (const address of localAddresses(port)) {
    console.log(`LAN access: ${address.url}`);
  }
  
  startScheduler((plan) => {
    broadcast({ type: 'plan', ...plan });
    console.log('Broadcast plan update:', plan.say);
  });
});
