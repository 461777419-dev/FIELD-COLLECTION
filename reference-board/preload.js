const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('journalDesktop', {
  dragImagesOut(ids) { ipcRenderer.send('drag-images-out', ids); }
});
