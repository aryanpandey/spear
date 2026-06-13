import { describe, it, expect } from "vitest";
import { buildMorningPlist } from "./launchd.js";
import { buildMorningSummary } from "./commands/morning.js";

describe("buildMorningPlist", () => {
  it("produces a valid plist that runs `spear morning` at the configured time", () => {
    const plist = buildMorningPlist({
      hour: 7,
      minute: 30,
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/spear/dist/cli.js",
    });
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<string>com.spear.morning</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/opt/spear/dist/cli.js</string>");
    expect(plist).toContain("<string>morning</string>");
    expect(plist).toMatch(/<key>Hour<\/key>\s*<integer>7<\/integer>/);
    expect(plist).toMatch(/<key>Minute<\/key>\s*<integer>30<\/integer>/);
  });
});

describe("buildMorningSummary", () => {
  it("leads with counts then the first sentence, truncated to 200 chars", () => {
    const body = buildMorningSummary("Start with login planning. Then delegate testing to CI.", 3, 2);
    expect(body).toBe("3 lane(s), 2 to start now. Start with login planning.");
  });

  it("truncates very long narratives", () => {
    const long = "x ".repeat(200);
    const body = buildMorningSummary(long, 1, 1);
    expect(body.length).toBeLessThanOrEqual(200);
    expect(body.endsWith("…")).toBe(true);
  });
});
