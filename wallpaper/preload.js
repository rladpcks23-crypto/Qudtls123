const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studylock", {
  getState: () => ipcRenderer.invoke("get-state"),
  save: (cfg) => ipcRenderer.invoke("save-config", cfg),
  lock: () => ipcRenderer.invoke("lock"),
  listRunning: () => ipcRenderer.invoke("list-running"),
  reattach: () => ipcRenderer.invoke("reattach"),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
  onToast: (cb) => ipcRenderer.on("toast", (_e, t) => cb(t)),
  onCursor: (cb) => ipcRenderer.on("cursor", (_e, p) => cb(p)),
  onAnger: (cb) => ipcRenderer.on("anger", (_e, ms) => cb(ms)),
});
