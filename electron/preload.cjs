const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('batteryAPI', {
  getBattery: () => ipcRenderer.invoke('battery:get'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getStats: () => ipcRenderer.invoke('stats:get'),
  openReport: () => ipcRenderer.invoke('app:open-report'),
  testAlert: () => ipcRenderer.invoke('app:test-alert'),
  onUpdate: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('battery:update', h)
    return () => ipcRenderer.removeListener('battery:update', h)
  },
  onAlert: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('app:alert', h)
    return () => ipcRenderer.removeListener('app:alert', h)
  },
  quit: () => ipcRenderer.send('app:quit')
})
