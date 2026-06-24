const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendTrayAction: (action, data) => ipcRenderer.send('tray-action', action, data),
  updateTrayHeight: (height) => ipcRenderer.send('update-tray-height', height),
  onUpdateTrayUi: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('update-tray-ui', subscription);
    return () => ipcRenderer.removeListener('update-tray-ui', subscription);
  }
});
