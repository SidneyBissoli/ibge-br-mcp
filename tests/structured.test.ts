import { describe, it, expect } from "vitest";
import { toMcpResult } from "../src/structured.js";

describe("toMcpResult", () => {
  it("maps a success result to text content + structuredContent", () => {
    const r = toMcpResult({ markdown: "# ok", structured: { a: 1 } });

    expect(r.content).toEqual([{ type: "text", text: "# ok" }]);
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.isError).toBeUndefined();
  });

  it("maps an error result to isError without structuredContent", () => {
    const r = toMcpResult({ markdown: "boom", isError: true, structured: { a: 1 } });

    expect(r.content).toEqual([{ type: "text", text: "boom" }]);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
  });

  it("omits structuredContent when there is no structured payload", () => {
    const r = toMcpResult({ markdown: "plain" });

    expect(r.content).toEqual([{ type: "text", text: "plain" }]);
    expect(r.structuredContent).toBeUndefined();
    expect(r.isError).toBeUndefined();
  });
});
