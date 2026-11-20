import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("window entry", () => {
  it("defines no components, so a hot update reloads the page instead of mounting a second root", () => {
    const entry = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
    expect(entry).not.toMatch(/^(?:export\s+)?(?:async\s+)?function\s+[A-Z]/mu);
    expect(entry).not.toMatch(/^(?:export\s+)?const\s+[A-Z]\w*\s*=/mu);
    expect(entry.match(/createRoot\(/gu)).toHaveLength(1);
  });
});
