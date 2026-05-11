import { localAddresses } from '../network.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/network',
    async handler(req, res) {
      res.json({
        port: Number(process.env.PORT ?? 8080),
        addresses: localAddresses(Number(process.env.PORT ?? 8080))
      });
    }
  }
];
