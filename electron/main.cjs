// Electron main process for the spear desktop app.
//
// It boots the spear server in-process (sharing ~/.spear with the CLI) and opens
// a window onto the local dashboard. Built dist/ is bundled by electron-builder.
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const http = require("node:http");
const { autoUpdater } = require("electron-updater");

const PORT = Number(process.env.SPEAR_PORT || 4317);
const URL = `http://127.0.0.1:${PORT}`;

let server = null;
let win = null;

async function boot() {
  const appPath = app.getAppPath();
  // Point the server at the packaged web build.
  process.env.SPEAR_WEB_DIR = path.join(appPath, "dist", "web");
  const bootUrl = pathToFileURL(path.join(appPath, "dist", "desktop", "boot.js")).href;
  const { bootDesktop } = await import(bootUrl);
  server = await bootDesktop(PORT); // null if a CLI `spear serve` already owns the port
}

function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get(`${URL}/api/today`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(ping, 150);
      });
    };
    ping();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 780,
    minHeight: 520,
    backgroundColor: "#060a06", // matches the Matrix theme; avoids white flash
    title: "spear",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.loadURL(URL);
  // Open any external links (e.g. downloads) in the user's browser, not the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.on("closed", () => {
    win = null;
  });
}

// Update flow: check GitHub Releases and PROMPT the user before downloading and
// again before installing (no silent updates). Only meaningful in a packaged
// build (the app-update.yml feed is baked in by electron-builder). Errors (e.g.
// an unsigned macOS build, which Squirrel.Mac can't update) are logged.
let updaterWired = false;
let manualCheck = false; // true when the user pressed Refresh, so we report "up to date"

function wireUpdater() {
  if (updaterWired) return;
  updaterWired = true;
  autoUpdater.autoDownload = false;

  autoUpdater.on("error", (e) => {
    console.error("[spear] update error:", e?.message || e);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({ type: "warning", buttons: ["OK"], title: "Update check failed", message: String(e?.message || e) });
    }
  });

  autoUpdater.on("update-available", async (info) => {
    manualCheck = false;
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `spear ${info?.version} is available.`,
      detail: "Download it now? You can keep working — you'll be asked before it installs.",
    });
    if (response === 0) autoUpdater.downloadUpdate().catch((e) => console.error("[spear] download failed:", e?.message || e));
  });

  autoUpdater.on("update-not-available", () => {
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({ type: "info", buttons: ["OK"], title: "Up to date", message: "You're on the latest version of spear." });
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `spear ${info?.version} is ready to install.`,
      detail: "Restart now to update?",
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
}

function runUpdateCheck({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox({ type: "info", buttons: ["OK"], title: "Updates", message: "Update checks only run in the installed desktop app." });
    }
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch((e) => {
    console.error("[spear] update check failed:", e?.message || e);
    if (manual) {
      manualCheck = false;
      dialog.showMessageBox({ type: "warning", buttons: ["OK"], title: "Update check failed", message: String(e?.message || e) });
    }
  });
}

// Renderer (the dashboard's Refresh button) asks to check for updates.
ipcMain.handle("spear:check-for-updates", async () => {
  runUpdateCheck({ manual: true });
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (err) {
    console.error("[spear] server boot failed:", err);
  }
  await waitForServer();
  createWindow();
  wireUpdater();
  runUpdateCheck({ manual: false }); // silent on launch; prompts only if an update exists

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function shutdown() {
  try {
    if (server) await server.close();
  } catch {
    /* ignore */
  }
  server = null;
}

app.on("window-all-closed", async () => {
  await shutdown();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", shutdown);
