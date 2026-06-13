import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopPlatform = "mac" | "win";

export interface DesktopArtifact {
  platform: DesktopPlatform;
  file: string;
  url: string;
  bytes: number;
}

export interface DesktopManifest {
  version: string;
  /** Best installer per platform, or null when not built yet. */
  mac: DesktopArtifact | null;
  win: DesktopArtifact | null;
}

/** Repo/package root, relative to the compiled dist/server/ location. */
function pkgRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function releaseDir(): string {
  return process.env.SPEAR_RELEASE_DIR ?? path.join(pkgRoot(), "release");
}

function version(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgRoot(), "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Classify a release file by platform. Higher rank = preferred installer for
 * that platform. Returns null for sidecar files (blockmaps, update metadata).
 * Pure — unit-tested.
 */
export function classifyArtifact(file: string): { platform: DesktopPlatform; rank: number } | null {
  const f = file.toLowerCase();
  if (f.endsWith(".blockmap") || f.endsWith(".yml") || f.endsWith(".yaml")) return null;
  if (f.endsWith(".dmg")) return { platform: "mac", rank: 3 };
  if (f.endsWith(".pkg")) return { platform: "mac", rank: 2 };
  if (f.endsWith(".exe")) return { platform: "win", rank: 3 };
  if (f.endsWith(".msi")) return { platform: "win", rank: 2 };
  if (f.endsWith(".zip")) {
    if (/(mac|darwin|osx)/.test(f)) return { platform: "mac", rank: 1 };
    if (/win/.test(f)) return { platform: "win", rank: 1 };
  }
  return null;
}

/** Scan the release/ dir and return the best installer per platform. */
export function desktopManifest(): DesktopManifest {
  const dir = releaseDir();
  const best: Record<DesktopPlatform, { file: string; rank: number; bytes: number } | null> = {
    mac: null,
    win: null,
  };
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    files = [];
  }
  for (const file of files) {
    const cls = classifyArtifact(file);
    if (!cls) continue;
    const cur = best[cls.platform];
    if (!cur || cls.rank > cur.rank) {
      let bytes = 0;
      try {
        bytes = fs.statSync(path.join(dir, file)).size;
      } catch {
        bytes = 0;
      }
      best[cls.platform] = { file, rank: cls.rank, bytes };
    }
  }
  const toArtifact = (p: DesktopPlatform): DesktopArtifact | null => {
    const b = best[p];
    return b ? { platform: p, file: b.file, url: `/download/${encodeURIComponent(b.file)}`, bytes: b.bytes } : null;
  };
  return { version: version(), mac: toArtifact("mac"), win: toArtifact("win") };
}
