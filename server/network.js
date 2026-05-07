import { networkInterfaces } from 'node:os';

export function localAddresses(port) {
  const addresses = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      addresses.push({
        address: item.address,
        url: `http://${item.address}:${port}`
      });
    }
  }
  return addresses;
}
