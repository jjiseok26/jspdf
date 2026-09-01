const { contextBridge, ipcRenderer } = require('electron');

const PDF_FILTER = [{ name: 'PDF 문서', extensions: ['pdf'] }];
const IMAGE_FILTER = [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg'] }];
const TEXT_FILTER = [{ name: '텍스트', extensions: ['txt', 'md'] }];

contextBridge.exposeInMainWorld('api', {
  openPdfs: (multi = false) => ipcRenderer.invoke('file:open', { filters: PDF_FILTER, multi }),
  openImages: (multi = true) => ipcRenderer.invoke('file:open', { filters: IMAGE_FILTER, multi }),
  openTexts: () => ipcRenderer.invoke('file:open', { filters: TEXT_FILTER, multi: true }),
  savePdf: (defaultName, data) =>
    ipcRenderer.invoke('file:save', { defaultName, filters: PDF_FILTER, data }),
  saveText: (defaultName, data) =>
    ipcRenderer.invoke('file:save', {
      defaultName,
      filters: [{ name: '텍스트/HTML', extensions: ['txt', 'html'] }],
      data
    }),
  saveFilesToFolder: (files) => ipcRenderer.invoke('file:saveMany', { files }),
  setFullScreen: (on) => ipcRenderer.invoke('window:fullscreen', on),
  onOpenFile: (handler) => {
    ipcRenderer.on('file:openExternal', (_e, payload) => handler(payload));
    ipcRenderer.send('file:ready');
  },
  version: () => ipcRenderer.invoke('app:version')
});
