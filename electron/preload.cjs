// Exposes a tiny, safe bridge to the renderer (the dashboard) so the in-app
// Refresh button can ask the main process to check for updates. Present only in
// the Electron desktop app — in a plain browser, window.spear is undefined.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spear", {
  isDesktop: true,
  checkForUpdates: () => ipcRenderer.invoke("spear:check-for-updates"),
});
