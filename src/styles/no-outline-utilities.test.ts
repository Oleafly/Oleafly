import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_DIRS = ["src", "packages"];
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const VARIANTS = String.raw`(?:(?:[\w-]+|\[[^\]\s]*\])(?:\/[\w-]+)?:)*`;
const RING_OR_OUTLINE = new RegExp(
  String.raw`(?:^|[\s"'\`])(` +
    VARIANTS +
    String.raw`!?(?:ring-(?:\d|ring|offset|inset|primary|secondary|black|white|border|transparent|foreground|muted|accent|destructive|\[)[^\s"'\`]*|outline-(?:none|hidden|offset|dashed|dotted|solid|double|\d|\[)[^\s"'\`]*)` +
    String.raw`|(?:(?:[\w-]+|\[[^\]\s]*\]):)+!?(?:ring|outline))(?=[\s"'\`]|$)`,
  "gm",
);

function sourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path))
      .filter((path) => !path.split(/[\\/]/).includes("node_modules"))
      .map((path) => join(ROOT, dir, path)),
  );
}

function findOutlineUtilities(text: string): string[] {
  return [...text.matchAll(RING_OR_OUTLINE)].map((match) => match[1]);
}

describe("no outlines or focus rings", () => {
  it("recognises ring and outline utilities with any variant", () => {
    expect(
      findOutlineUtilities(
        'cn("focus-visible:ring-2 focus-visible:ring-ring ring-offset-background outline-none", `focus:outline-none [&_button:focus-visible]:ring-inset group-hover:ring-primary/50 focus-visible:ring`)',
      ),
    ).toEqual([
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "ring-offset-background",
      "outline-none",
      "focus:outline-none",
      "[&_button:focus-visible]:ring-inset",
      "group-hover:ring-primary/50",
      "focus-visible:ring",
    ]);
  });

  it("leaves focus tints, border colours and prose alone", () => {
    expect(
      findOutlineUtilities(
        '"focus-visible:border-ring focus-visible:bg-accent/60 border-ring" "a ring all-reduce" "outline" "--ring"',
      ),
    ).toEqual([]);
  });

  it("finds no ring or outline utility anywhere in the app or packages", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.flatMap((file) =>
      findOutlineUtilities(readFileSync(file, "utf8")).map(
        (token) => `${relative(ROOT, file)}: ${token}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
