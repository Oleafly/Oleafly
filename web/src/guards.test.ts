import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./i18n/en.json";

const WEB = resolve(__dirname, "..");
const SOURCE = /\.(?:ts|tsx|css|html)$/u;
const TEST = /\.test\.(?:ts|tsx)$/u;
const RING_OR_OUTLINE =
  /(?:^|[\s"'`])((?:[\w-]+:)*!?(?:ring-[\w[\]/.-]+|outline-(?:none|hidden|offset|dashed|dotted|solid|double|\d)[\w-]*)|(?:[\w-]+:)+!?(?:ring|outline))(?=[\s"'`]|$)/gmu;
const PIXEL_TEXT = /text-\[\d+(?:\.\d+)?px\]/u;
const CSS_OUTLINE = /(?:^|[;{\s])(?:outline|box-shadow)\s*:/mu;

function sources(): string[] {
  return ["src", "dev", "index.html"].flatMap((entry) => {
    if (entry.endsWith(".html")) return [join(WEB, entry)];
    return readdirSync(join(WEB, entry), { recursive: true, encoding: "utf8" })
      .filter((path) => SOURCE.test(path) && !TEST.test(path))
      .map((path) => join(WEB, entry, path));
  });
}

function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => strings(child, path ? `${path}.${key}` : key));
  }
  return [];
}

describe("web app guards", () => {
  it("recognises outline and ring utilities but not the outline button variant", () => {
    const sample = 'focus-visible:ring-2 outline-none hover:outline variant="outline"';
    expect([...sample.matchAll(RING_OR_OUTLINE)].map((match) => match[1])).toEqual([
      "focus-visible:ring-2",
      "outline-none",
      "hover:outline",
    ]);
  });

  it("uses no outline or ring utilities and no pixel text sizes", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(file, "utf8");
      const rings = [...text.matchAll(RING_OR_OUTLINE)].map((match) => match[1]);
      if (rings.length > 0) offenders.push(`${file}: ${rings.join(", ")}`);
      if (PIXEL_TEXT.test(text)) offenders.push(`${file}: pixel text size`);
      if (file.endsWith(".css") && CSS_OUTLINE.test(text)) offenders.push(`${file}: outline or box-shadow`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps interface copy plain: no em dashes, exclamation marks or trailing ellipses", () => {
    const offenders = strings(en).filter(
      ([, value]) => value.includes("—") || value.includes("!") || /(?:\.\.\.|…)$/u.test(value),
    );
    expect(offenders).toEqual([]);
  });
});
