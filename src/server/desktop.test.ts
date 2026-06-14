import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyArtifact, localManifest } from "./desktop.js";

describe("classifyArtifact", () => {
  it("maps installers to platforms by extension", () => {
    expect(classifyArtifact("spear-0.1.0-arm64.dmg")?.platform).toBe("mac");
    expect(classifyArtifact("spear-Setup-0.1.0.exe")?.platform).toBe("win");
    expect(classifyArtifact("spear-0.1.0.pkg")?.platform).toBe("mac");
    expect(classifyArtifact("spear-0.1.0.msi")?.platform).toBe("win");
  });

  it("classifies zips by name hint", () => {
    expect(classifyArtifact("spear-0.1.0-mac.zip")?.platform).toBe("mac");
    expect(classifyArtifact("spear-0.1.0-win.zip")?.platform).toBe("win");
  });

  it("prefers dmg over zip for mac", () => {
    expect(classifyArtifact("a.dmg")!.rank).toBeGreaterThan(classifyArtifact("a-mac.zip")!.rank);
  });

  it("prefers the Windows installer over the portable exe", () => {
    expect(classifyArtifact("spear-Setup-0.1.6.exe")!.rank).toBeGreaterThan(classifyArtifact("spear-0.1.6.exe")!.rank);
  });

  it("ignores sidecar metadata files", () => {
    expect(classifyArtifact("spear-0.1.0.dmg.blockmap")).toBeNull();
    expect(classifyArtifact("latest-mac.yml")).toBeNull();
    expect(classifyArtifact("builder-effective-config.yaml")).toBeNull();
  });
});

describe("localManifest (GitHub fallback)", () => {
  it("picks the best installer per platform from the release dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spear-rel-"));
    try {
      fs.writeFileSync(path.join(dir, "spear-0.1.0-arm64.dmg"), "x");
      fs.writeFileSync(path.join(dir, "spear-0.1.0-mac.zip"), "x"); // lower rank than dmg
      fs.writeFileSync(path.join(dir, "spear-0.1.0.dmg.blockmap"), "x"); // ignored
      process.env.SPEAR_RELEASE_DIR = dir;
      const m = localManifest();
      expect(m.source).toBe("local");
      expect(m.mac?.file).toBe("spear-0.1.0-arm64.dmg");
      expect(m.mac?.url).toBe("/download/spear-0.1.0-arm64.dmg");
      expect(m.win).toBeNull();
    } finally {
      delete process.env.SPEAR_RELEASE_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns nulls when nothing is built", () => {
    process.env.SPEAR_RELEASE_DIR = path.join(os.tmpdir(), "spear-nonexistent-" + Math.random().toString(36).slice(2));
    try {
      const m = localManifest();
      expect(m.mac).toBeNull();
      expect(m.win).toBeNull();
    } finally {
      delete process.env.SPEAR_RELEASE_DIR;
    }
  });
});
