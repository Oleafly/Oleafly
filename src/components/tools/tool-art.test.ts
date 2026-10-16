import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@/lib/tool-catalog";
import { TOOL_ART_HEIGHT, TOOL_ART_WIDTH, toolArt } from "./tool-art";

const ART_DIR = join(process.cwd(), "public", "tool-art");

/** Width and height of a WebP file, read from its VP8, VP8L or VP8X header. */
function webpSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("tool art", () => {
  it("has a picture for every tool the gallery shows", () => {
    const missing = TOOL_DEFINITIONS.filter((tool) => {
      const src = toolArt(tool.id);
      return !src || !existsSync(join(process.cwd(), "public", src));
    }).map((tool) => tool.id);
    expect(missing).toEqual([]);
  });

  it("keeps every picture a small 720x406 WebP", () => {
    let total = 0;
    for (const tool of TOOL_DEFINITIONS) {
      const src = toolArt(tool.id);
      if (!src) continue;
      expect(src).toBe(`/tool-art/${tool.id}.webp`);
      const bytes = readFileSync(join(process.cwd(), "public", src));
      expect(bytes.length, src).toBeLessThanOrEqual(10 * 1024);
      expect(webpSize(bytes), src).toEqual({ width: TOOL_ART_WIDTH, height: TOOL_ART_HEIGHT });
      total += bytes.length;
    }
    expect(total).toBeLessThanOrEqual(450 * 1024);
  });

  it("ships no picture that no tool uses", () => {
    const used = new Set(TOOL_DEFINITIONS.map((tool) => `${tool.id}.webp`));
    const unused = readdirSync(ART_DIR).filter(
      (file) => !file.startsWith(".") && !used.has(file),
    );
    expect(unused).toEqual([]);
  });
});
