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
  /** Where the installers came from. */
  source: "github" | "local";
  /** Best installer per platform, or null when none is available. */
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

function pkg(): { version?: string; build?: { publish?: { owner?: string; repo?: string } } } {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgRoot(), "package.json"), "utf8"));
  } catch {
    return {};
  }
}

/** owner/repo for the GitHub Releases feed (from publish config, overridable). */
export function repoSlug(): string {
  if (process.env.SPEAR_GH_REPO) return process.env.SPEAR_GH_REPO;
  const pub = pkg().build?.publish;
  if (pub?.owner && pub?.repo) return `${pub.owner}/${pub.repo}`;
  return "aryanpandey/spear";
}

/**
 * Classify a release file by platform. Higher rank = preferred installer for
 * that platform (Windows installer > portable). Returns null for sidecar files
 * (blockmaps, update metadata). Pure — unit-tested.
 */
export function classifyArtifact(file: string): { platform: DesktopPlatform; rank: number } | null {
  const f = file.toLowerCase();
  if (f.endsWith(".blockmap") || f.endsWith(".yml") || f.endsWith(".yaml")) return null;
  if (f.endsWith(".dmg")) return { platform: "mac", rank: 3 };
  if (f.endsWith(".pkg")) return { platform: "mac", rank: 2 };
  if (f.endsWith(".exe")) return { platform: "win", rank: /setup/.test(f) ? 4 : 3 }; // installer over portable
  if (f.endsWith(".msi")) return { platform: "win", rank: 2 };
  if (f.endsWith(".zip")) {
    if (/(mac|darwin|osx)/.test(f)) return { platform: "mac", rank: 1 };
    if (/win/.test(f)) return { platform: "win", rank: 1 };
  }
  return null;
}

interface NamedAsset {
  name: string;
  url: string;
  bytes: number;
}

/** Pick the highest-ranked installer per platform from a list of named files. */
function bestPerPlatform(assets: NamedAsset[]): { mac: DesktopArtifact | null; win: DesktopArtifact | null } {
  const best: Record<DesktopPlatform, { a: NamedAsset; rank: number } | null> = { mac: null, win: null };
  for (const a of assets) {
    const cls = classifyArtifact(a.name);
    if (!cls) continue;
    const cur = best[cls.platform];
    if (!cur || cls.rank > cur.rank) best[cls.platform] = { a, rank: cls.rank };
  }
  const toArtifact = (p: DesktopPlatform): DesktopArtifact | null => {
    const b = best[p];
    return b ? { platform: p, file: b.a.name, url: b.a.url, bytes: b.a.bytes } : null;
  };
  return { mac: toArtifact("mac"), win: toArtifact("win") };
}

/** Fetch the latest published GitHub Release and map its assets. Null on failure. */
export async function githubManifest(): Promise<DesktopManifest | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "spear-dashboard",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repoSlug()}/releases/latest`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rel = (await res.json()) as {
      tag_name?: string;
      name?: string;
      assets?: { name: string; browser_download_url: string; size: number }[];
    };
    const assets: NamedAsset[] = (rel.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      bytes: a.size,
    }));
    const { mac, win } = bestPerPlatform(assets);
    if (!mac && !win) return null;
    return { version: (rel.tag_name ?? rel.name ?? "").replace(/^v/, ""), source: "github", mac, win };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Scan the local release/ dir for installers (fallback when GitHub is unreachable). */
export function localManifest(): DesktopManifest {
  const dir = releaseDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    files = [];
  }
  const assets: NamedAsset[] = [];
  for (const file of files) {
    if (!classifyArtifact(file)) continue;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(dir, file)).size;
    } catch {
      bytes = 0;
    }
    assets.push({ name: file, url: `/download/${encodeURIComponent(file)}`, bytes });
  }
  const { mac, win } = bestPerPlatform(assets);
  return { version: pkg().version ?? "0.0.0", source: "local", mac, win };
}

/** Latest installers — prefer the published GitHub Release, fall back to local. */
export async function desktopManifest(): Promise<DesktopManifest> {
  return (await githubManifest()) ?? localManifest();
}
