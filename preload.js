const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fern", {
  setToken: (token) => ipcRenderer.invoke("auth:setToken", token),
  clearToken: () => ipcRenderer.invoke("auth:clear"),
  getDevices: () => ipcRenderer.invoke("data:devices"),
  getTelemetry: () => ipcRenderer.invoke("data:telemetry"),
  saveFile: (payload) => ipcRenderer.invoke("data:saveFile", payload)
});
