// Shared broadcast hook. server/index.js wires this up once WebSocket server
// is ready; other modules (router, scheduler) can then call broadcast()
// without importing the WS server directly.
import { logger } from './logger.js';

const log = logger.withTag('broadcast');

let broadcaster = null;

export function setBroadcaster(fn) {
  broadcaster = fn;
}

export function broadcast(message) {
  if (typeof broadcaster === 'function') {
    try {
      broadcaster(message);
    } catch (error) {
      log.warn('broadcast failed', { error: error.message });
    }
  }
}
