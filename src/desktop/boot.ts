import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { startServer, type SpearServer } from "../server/app.js";

/**
 * Boot the full spear server (Fastify API + SSE + static SPA) in-process for the
 * Electron desktop shell. Reuses the same ~/.spear database and config as the
 * CLI, so the desktop app and `spear` share state.
 *
 * Returns the server handle, or null if the port is already serving spear (e.g.
 * a `spear serve` is already running) — in that case the Electron window simply
 * loads the existing instance.
 */
export async function bootDesktop(port?: number): Promise<SpearServer | null> {
  const cfg = loadConfig();
  const target = port ?? cfg.port;
  try {
    const store = openStore();
    return await startServer(store, cfg, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EADDRINUSE") return null; // another spear is already on this port
    throw err;
  }
}
