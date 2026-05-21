const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cockpit', {
  onChain: (cb) => ipcRenderer.on('chain', (_e, data) => cb(data)),
  onChange: (cb) => ipcRenderer.on('change', (_e, data) => cb(data)),
  onRestore: (cb) => ipcRenderer.on('restore', (_e, data) => cb(data)),
  ack: (root, id) => ipcRenderer.send('ack', { root, id }),
  ackAll: (root) => ipcRenderer.send('ack-all', { root }),
});
