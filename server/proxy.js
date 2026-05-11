import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { logger } from './logger.js';

export function configureFetchProxy() {
  const hasProxy = process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || process.env.ALL_PROXY
    || process.env.https_proxy
    || process.env.http_proxy
    || process.env.all_proxy;

  if (!hasProxy) return;

  setGlobalDispatcher(new EnvHttpProxyAgent());
  logger.withTag('proxy').info('fetch proxy enabled from environment');
}
