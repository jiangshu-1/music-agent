const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

ipcRenderer.on('claudio:media', (_event, action) => {
  const handlers = listeners.get('media') ?? [];
  for (const handler of handlers) {
    try {
      handler(action);
    } catch (error) {
      console.error('claudio.on("media") handler threw:', error);
    }
  }
});

contextBridge.exposeInMainWorld('claudio', {
  openExternal: (url) => ipcRenderer.send('claudio:open-external', url),
  quit: () => ipcRenderer.send('claudio:quit'),
  hide: () => ipcRenderer.send('claudio:hide'),
  on: (channel, handler) => {
    if (typeof handler !== 'function') return;
    const list = listeners.get(channel) ?? [];
    list.push(handler);
    listeners.set(channel, list);
  }
});
