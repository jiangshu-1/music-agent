const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

ipcRenderer.on('claudio:media', (_event, action) => {
  const handlers = listeners.get('media') ?? [];
  for (const handler of handlers) {
    try {
      handler(action);
    } catch (error) {
      console.error('此刻 bridge media handler threw:', error);
    }
  }
});

const bridgeApi = {
  openExternal: (url) => ipcRenderer.send('claudio:open-external', url),
  quit: () => ipcRenderer.send('claudio:quit'),
  hide: () => ipcRenderer.send('claudio:hide'),
  on: (channel, handler) => {
    if (typeof handler !== 'function') return;
    const list = listeners.get(channel) ?? [];
    list.push(handler);
    listeners.set(channel, list);
  }
};

contextBridge.exposeInMainWorld('cike', bridgeApi);
contextBridge.exposeInMainWorld('claudio', bridgeApi);
