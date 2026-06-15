import { describe, it, expect } from "vitest";
import { extractJson } from "./cli.js";

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
