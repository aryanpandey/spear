// Electron main process for the spear desktop app.
//
// It boots the spear server in-process (sharing ~/.spear with the CLI) and opens
// a window onto the local dashboard. Built dist/ is bundled by electron-builder.
const { app, BrowserWindow, shell, dialog, ipcMain, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
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

// Update flow: check GitHub Releases and PROMPT before doing anything (no silent
// updates). Only meaningful in a packaged build (the app-update.yml feed is baked
// in by electron-builder).
//
// macOS: the app is unsigned and ships as a .dmg, so Squirrel.Mac can't do an
// in-place auto-update. Instead we download the new .dmg into ~/Downloads and
// reveal it in Finder for the user to drag into Applications.
// Windows: unsigned nsis can still auto-update in place, so that path is kept.
let updaterWired = false;
let manualCheck = false; // true when the user pressed Refresh, so we report "up to date"

// owner/repo for constructing a release download URL (fallback if the in-app
// manifest is unreachable). Read from the bundled package.json's publish config.
function publishSlug() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    const p = pkg.build && pkg.build.publish;
    if (p && p.owner && p.repo) return `${p.owner}/${p.repo}`;
  } catch {
    /* fall through */
  }
  return "aryanpandey/spear";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

// Resolve the macOS .dmg download URL + filename for an available update.
// Prefer the running server's GitHub manifest (absolute browser_download_url);
// fall back to constructing the release URL from electron-updater's info.
async function macInstallerInfo(info) {
  try {
    const m = await fetchJson(`${URL}/api/desktop/manifest`);
    if (m && m.mac && m.mac.url && m.mac.file) return { url: m.mac.url, file: m.mac.file };
  } catch {
    /* fall through to constructed URL */
  }
  const file = (info && info.files && info.files[0] && info.files[0].url) || `spear-${info && info.version}-arm64.dmg`;
  return {
    url: `https://github.com/${publishSlug()}/releases/download/v${info && info.version}/${encodeURIComponent(file)}`,
    file,
  };
}

// Stream a file into the user's Downloads folder, showing dock progress.
function downloadToDownloads(url, filename) {
  const dest = path.join(app.getPath("downloads"), filename);
  return new Promise((resolve, reject) => {
    const request = net.request(url); // electron net follows GitHub→S3 redirects
    request.on("response", (response) => {
      const status = response.statusCode || 0;
      if (status >= 400) {
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const out = fs.createWriteStream(dest);
      out.on("error", reject);
      response.on("data", (chunk) => {
        received += chunk.length;
        out.write(chunk);
        if (total && win && !win.isDestroyed()) win.setProgressBar(received / total);
      });
      response.on("end", () => {
        out.end();
        if (win && !win.isDestroyed()) win.setProgressBar(-1);
        resolve(dest);
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

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

    if (process.platform === "darwin") {
      // Unsigned mac build: download the .dmg to ~/Downloads and reveal it.
      const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update available",
        message: `spear ${info?.version} is available.`,
        detail: "Download the installer to your Downloads folder? You'll then drag spear into Applications to finish.",
      });
      if (response !== 0) return;
      try {
        const { url, file } = await macInstallerInfo(info);
        const dest = await downloadToDownloads(url, file);
        shell.showItemInFolder(dest);
        await dialog.showMessageBox({
          type: "info",
          buttons: ["OK"],
          title: "Downloaded to Downloads",
          message: `spear ${info?.version} was saved to your Downloads folder.`,
          detail: "Open the .dmg and drag spear into Applications (replacing the old version) to finish updating.",
        });
      } catch (e) {
        console.error("[spear] dmg download failed:", e?.message || e);
        dialog.showMessageBox({ type: "warning", buttons: ["OK"], title: "Download failed", message: String(e?.message || e) });
      }
      return;
    }

    // Windows/Linux: in-place auto-update still works.
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
