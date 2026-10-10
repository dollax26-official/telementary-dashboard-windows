const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fern", {
  setToken: (token) => ipcRenderer.invoke("auth:setToken", token),
  clearToken: () => ipcRenderer.invoke("auth:clear"),
  getDevices: () => ipcRenderer.invoke("data:devices"),
  getTelemetry: () => ipcRenderer.invoke("data:telemetry"),
  getWorldBackups: () => ipcRenderer.invoke("data:worldBackups"),
  downloadWorldBackup: (payload) => ipcRenderer.invoke("data:downloadWorldBackup", payload),
  saveFile: (payload) => ipcRenderer.invoke("data:saveFile", payload)
});
