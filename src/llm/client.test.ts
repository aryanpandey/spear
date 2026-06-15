import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAnthropic, hasApiKey, resolveApiKey } from "./client.js";

describe("resolveApiKey", () => {
  let home: string;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedHome = process.env.SPEAR_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "spear-client-"));
    process.env.SPEAR_HOME = home;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedHome === undefined) delete process.env.SPEAR_HOME;
    else process.env.SPEAR_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeConfig = (obj: Record<string, unknown>): void =>
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(obj));

  it("returns undefined when neither env nor config has a key", () => {
    expect(resolveApiKey()).toBeUndefined();
    expect(hasApiKey()).toBe(false);
    expect(getAnthropic()).toBeNull();
  });

  it("falls back to the config-file key when the env var is unset", () => {
    writeConfig({ anthropicApiKey: "sk-from-config" });
    expect(resolveApiKey()).toBe("sk-from-config");
    expect(hasApiKey()).toBe(true);
    expect(getAnthropic()).not.toBeNull();
  });

  it("prefers the environment key over the config file", () => {
    writeConfig({ anthropicApiKey: "sk-from-config" });
    process.env.ANTHROPIC_API_KEY = "sk-from-env";
    expect(resolveApiKey()).toBe("sk-from-env");
  });

  it("treats an empty config key as no key", () => {
    writeConfig({ anthropicApiKey: "" });
    expect(resolveApiKey()).toBeUndefined();
    expect(getAnthropic()).toBeNull();
  });
});
