import { describe, it, expect } from "vitest";
import { extractJson, buildClaudeArgs } from "./cli.js";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose around the JSON", () => {
    expect(extractJson('Sure! Here is the plan:\n{"a":[1,2]}\nLet me know.')).toEqual({ a: [1, 2] });
  });

  it("parses a top-level array", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("buildClaudeArgs", () => {
  it("includes model, effort and allowedTools when provided", () => {
    const args = buildClaudeArgs("hi", { model: "m", effort: "low", allowedTools: ["Read"] });
    expect(args.slice(0, 4)).toEqual(["-p", "hi", "--output-format", "json"]);
    expect(args).toContain("--model");
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
  });

  it("omits allowedTools when not provided", () => {
    const args = buildClaudeArgs("hi", {});
    expect(args).not.toContain("--allowedTools");
  });

  it("joins multiple allowed tools with a space", () => {
    const args = buildClaudeArgs("hi", { allowedTools: ["Read", "Glob"] });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read Glob");
  });
});
