import { createRouter, createStaticServer } from './router-core.js';
import { routes } from './routes/index.js';

export { routes };

export const route = createRouter(routes, {
  staticServer: createStaticServer()
});
