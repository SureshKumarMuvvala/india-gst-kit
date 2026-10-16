import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  JsonNumber,
  convertNumbers,
  getAt,
  isNumberLeaf,
  markNumber,
  parseJsonLossless,
  parseLenient,
  pathStartsWith,
  zodPath,
  type LosslessTypeIssue,
} from "../src/index.js";

const Schema = z.strictObject({
  amt: markNumber(z.string()),
  name: z.string(),
  items: z.array(z.strictObject({ q: markNumber(z.string()) })),
});

describe("parseJsonLossless", () => {
  it("keeps every number as its source text", () => {
    const v = parseJsonLossless('{"a":9999999999999.99,"b":1e3,"c":1.10,"d":[0.1]}') as Record<
      string,
      unknown
    >;
    expect(v["a"]).toEqual(new JsonNumber("9999999999999.99"));
    expect((v["b"] as JsonNumber).source).toBe("1e3");
    expect((v["c"] as JsonNumber).source).toBe("1.10");
    expect(((v["d"] as unknown[])[0] as JsonNumber).source).toBe("0.1");
  });

  it("leaves strings, booleans and null alone and throws SyntaxError on bad JSON", () => {
    expect(parseJsonLossless('{"s":"1","t":true,"n":null}')).toEqual({ s: "1", t: true, n: null });
    expect(() => parseJsonLossless("{")).toThrow(SyntaxError);
  });
});

describe("convertNumbers", () => {
  it("turns numbers at number leaves into their source text", () => {
    const issues: LosslessTypeIssue[] = [];
    const raw = parseJsonLossless('{"amt":1180.10,"name":"x","items":[{"q":2}]}');
    expect(convertNumbers(raw, Schema, [], issues)).toEqual({
      amt: "1180.10",
      name: "x",
      items: [{ q: "2" }],
    });
    expect(issues).toEqual([]);
  });

  it("reports a string where a number belongs and a number where a string belongs", () => {
    const issues: LosslessTypeIssue[] = [];
    const raw = parseJsonLossless('{"amt":"5","name":7,"items":[{"q":"1"}]}');
    const out = convertNumbers(raw, Schema, [], issues, ["data"]) as Record<string, unknown>;
    expect(issues).toEqual([
      { path: ["data", "amt"], message: "expected a JSON number, found a string" },
      { path: ["data", "name"], message: "expected a string, found a JSON number" },
      { path: ["data", "items", 0, "q"], message: "expected a JSON number, found a string" },
    ]);
    expect(out["amt"]).toBeUndefined();
    expect(out["name"]).toBeUndefined();
  });

  it("converts numbers where the schema is silent (unknown keys)", () => {
    const issues: LosslessTypeIssue[] = [];
    const out = convertNumbers(parseJsonLossless('{"zzz":1.0}'), Schema, [], issues);
    expect(out).toEqual({ zzz: "1.0" });
  });
});

describe("number-leaf marking", () => {
  it("sees through optional and nullable wrappers", () => {
    expect(isNumberLeaf(markNumber(z.string()).optional())).toBe(true);
    expect(isNumberLeaf(markNumber(z.string()).nullable().optional())).toBe(true);
    expect(isNumberLeaf(z.string())).toBe(false);
  });
});

describe("parseLenient", () => {
  it("drops unknown keys, reports their full paths and does not mutate the input", () => {
    const input = { amt: "1", name: "n", extra: 1, items: [{ q: "1", more: true }] };
    const r = parseLenient(Schema, input);
    expect(r.issues).toEqual([]);
    expect(r.data).toEqual({ amt: "1", name: "n", items: [{ q: "1" }] });
    expect(r.unknown).toHaveLength(2);
    expect(r.unknown).toContainEqual(["extra"]);
    expect(r.unknown).toContainEqual(["items", 0, "more"]);
    expect(input).toHaveProperty("extra");
  });

  it("returns the genuine issues once only those remain", () => {
    const r = parseLenient(Schema, { amt: "1", extra: 1, items: [] });
    expect(r.data).toBeUndefined();
    expect(r.unknown).toEqual([["extra"]]);
    expect(r.issues.map((i) => zodPath(i.path))).toEqual([["name"]]);
  });
});

describe("path helpers", () => {
  it("pathStartsWith", () => {
    expect(pathStartsWith(["a", 0, "b"], ["a", 0])).toBe(true);
    expect(pathStartsWith(["a"], ["a", 0])).toBe(false);
    expect(pathStartsWith(["a", 1], ["a", 0])).toBe(false);
  });
  it("getAt", () => {
    expect(getAt({ a: [{ b: 5 }] }, ["a", 0, "b"])).toBe(5);
    expect(getAt({ a: 1 }, ["a", "b"])).toBeUndefined();
  });
});
