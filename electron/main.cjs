// Electron main process for the spear desktop app.
//
// It boots the spear server in-process (sharing ~/.spear with the CLI) and opens
// a window onto the local dashboard. Built dist/ is bundled by electron-builder.
const { app, BrowserWindow, shell } = require("electron");
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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

// Check GitHub Releases for a newer version, download in the background, and
// install on quit. Only in a packaged build (publish feed baked in via
// electron-builder's app-update.yml). Errors (e.g. an unsigned macOS build,
// which Squirrel.Mac can't update) are logged, not fatal.
function checkForUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (e) => console.error("[spear] update error:", e?.message || e));
  autoUpdater.on("update-available", (i) => console.log("[spear] update available:", i?.version));
  autoUpdater.on("update-not-available", () => console.log("[spear] up to date"));
  autoUpdater.on("update-downloaded", (i) =>
    console.log("[spear] update", i?.version, "downloaded — installs on quit"),
  );
  autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error("[spear] update check failed:", e?.message || e));
}

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (err) {
    console.error("[spear] server boot failed:", err);
  }
  await waitForServer();
  createWindow();
  if (app.isPackaged) checkForUpdates();

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
