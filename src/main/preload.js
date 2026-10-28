const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hop', {
  getState: () => ipcRenderer.invoke('hop:state'),
  chooseAndSend: (peerId, kind = 'files') => ipcRenderer.invoke('hop:choose-send', peerId, kind),
  sendDrop: (peerId, files) => ipcRenderer.invoke('hop:send', peerId, Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  chooseDownloadDir: () => ipcRenderer.invoke('hop:choose-directory'),
  updateSettings: values => ipcRenderer.invoke('hop:settings', values),
  clearTrust: () => ipcRenderer.invoke('hop:clear-trust'),
  respondOffer: (id, accept, always) => ipcRenderer.invoke('hop:respond', id, accept, always),
  openDownloads: () => ipcRenderer.invoke('hop:open-downloads'),
  openLogs: () => ipcRenderer.invoke('hop:open-logs'),
  windowAction: action => ipcRenderer.invoke('hop:window', action),
  onEvent: callback => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('hop:event', listener);
    return () => ipcRenderer.removeListener('hop:event', listener);
  }
});
