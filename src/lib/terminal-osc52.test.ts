import { describe, expect, it } from "vitest";
import { OSC52_MAX_BYTES, parseOsc52 } from "./terminal-osc52";

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe("OSC 52", () => {
  it("decodes clipboard writes, including UTF-8 text", () => {
    expect(parseOsc52("c;aGVsbG8=")).toEqual({ kind: "write", text: "hello" });
    expect(parseOsc52(";aGVsbG8=")).toEqual({ kind: "write", text: "hello" });
    expect(parseOsc52("pc;aGVs\nbG8=")).toEqual({ kind: "write", text: "hello" });
    expect(parseOsc52(`c;${base64("é漢")}`)).toEqual({ kind: "write", text: "é漢" });
  });

  it("recognises a query and never answers it", () => {
    expect(parseOsc52("c;?")).toEqual({ kind: "query" });
  });

  it("refuses malformed, empty and oversized payloads", () => {
    expect(parseOsc52("c;!!!")).toEqual({ kind: "invalid" });
    expect(parseOsc52("nosemicolon")).toEqual({ kind: "invalid" });
    expect(parseOsc52("c;")).toEqual({ kind: "invalid" });
    expect(parseOsc52(`c;${"A".repeat(1_400_000)}`)).toEqual({ kind: "invalid" });
    const atLimit = parseOsc52(`c;${btoa("x".repeat(OSC52_MAX_BYTES))}`);
    expect(atLimit).toMatchObject({ kind: "write" });
  });
});
