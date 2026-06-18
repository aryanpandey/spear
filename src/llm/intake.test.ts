import { describe, it, expect } from "vitest";
import { extractTaskSeeds } from "./intake.js";

const opts = { model: "m", effort: "low" as const };

describe("extractTaskSeeds", () => {
  it("returns the model's seeds", async () => {
    const run = async () => ({
      seeds: [
        { title: "Fix login", details: "login button dead on safari" },
        { title: "Add CSV export", details: "reports page" },
      ],
    });
    const seeds = await extractTaskSeeds("from this image", "/tmp/x.png", opts, run);
    expect(seeds).toHaveLength(2);
    expect(seeds[0].title).toBe("Fix login");
  });

  it("falls back to a single seed from the prompt when the model returns none", async () => {
    const run = async () => ({ seeds: [] });
    const seeds = await extractTaskSeeds("just one thing to do", undefined, opts, run);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].title).toBe("just one thing to do");
  });

  it("passes allowedTools:[Read] to the runner when an image is attached", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("p", "/tmp/x.png", opts, run);
    expect(seen.allowedTools).toEqual(["Read"]);
  });

  it("does not set allowedTools when there is no image", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("p", undefined, opts, run);
    expect(seen.allowedTools).toBeUndefined();
  });
});

describe("extractTaskSeeds URL fetch", () => {
  it("enables WebFetch + Notion fetch when the prompt has a URL", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("get tasks from https://app.notion.com/p/abc", undefined, opts, run);
    expect(seen.allowedTools).toContain("WebFetch");
    expect(seen.allowedTools).toContain("mcp__claude_ai_Notion__notion-fetch");
  });
  it("does not enable fetch tools for a plain prompt", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("just a normal task", undefined, opts, run);
    expect(seen.allowedTools).toBeUndefined();
  });
});
