import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { logger as rootLogger } from './logger.js';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const noStoreExts = new Set(['.html', '.css', '.js']);

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large');
    this.status = 413;
  }
}

function requestId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `req-${Date.now().toString(36)}-${random}`;
}

export function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 1_000_000) {
        settled = true;
        reject(new PayloadTooLargeError());
      }
    });
    req.on('end', () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

export function createStaticServer({ webRoot = join(process.cwd(), 'web') } = {}) {
  return function serveStatic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const aliases = {
      '/': '/index.html',
      '/mini': '/mini.html',
      '/mini/': '/mini.html'
    };
    const requested = aliases[url.pathname] ?? url.pathname;
    const filePath = normalize(join(webRoot, requested));

    if (!filePath.startsWith(webRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const ext = extname(filePath);
      const file = readFileSync(filePath);
      const headers = { 'content-type': mime[ext] ?? 'application/octet-stream' };
      if (noStoreExts.has(ext)) headers['cache-control'] = 'no-store';
      res.writeHead(200, headers);
      res.end(file);
    } catch {
      if (!res.headersSent) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      }
    }
  };
}

function normalizeRoute(route) {
  return {
    ...route,
    method: String(route.method).toUpperCase(),
    path: route.path
  };
}

export function createRouter(routes, { staticServer = createStaticServer(), logger = rootLogger.withTag('request') } = {}) {
  const table = routes.map(normalizeRoute);

  return async function route(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const method = String(req.method ?? 'GET').toUpperCase();
    req.reqId = requestId();
    req.log = logger.child({ reqId: req.reqId, method, path: url.pathname });
    req.urlObject = url;
    req.body = () => readBody(req);
    res.json = (data, status = 200) => json(res, data, status);
    res.setHeader('x-request-id', req.reqId);

    let completed = false;
    const logComplete = () => {
      if (completed) return;
      completed = true;
      req.log.info('request completed', {
        status: res.statusCode,
        durMs: Date.now() - started
      });
    };
    res.once('finish', logComplete);
    res.once('close', logComplete);

    try {
      const pathRoutes = table.filter((item) => item.path === url.pathname);
      const matched = pathRoutes.find((item) => item.method === method);
      if (matched) return await matched.handler(req, res);

      if (pathRoutes.length) {
        const allow = [...new Set(pathRoutes.map((item) => item.method))].sort().join(', ');
        res.writeHead(405, {
          allow,
          'content-type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      return staticServer(req, res);
    } catch (error) {
      const status = error instanceof PayloadTooLargeError ? 413 : 500;
      if (res.headersSent) {
        req.log.error('request failed after headers sent', { error: error.message });
        return;
      }
      res.json({ error: error.message }, status);
    }
  };
}
