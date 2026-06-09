const { contextBridge, ipcRenderer } = require('electron');

const validEvents = new Set([
  'listening-status',
  'transcription-update',
  'question-detected',
  'answer-generated',
  'overlay-preferences'
]);

contextBridge.exposeInMainWorld('overlayAPI', {
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel, callback) {
    if (!validEvents.has(channel)) {
      return () => {};
    }

    const listener = (event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  log(eventName, details = {}) {
    return ipcRenderer.invoke('overlay-renderer-log', eventName, details);
  }
});
