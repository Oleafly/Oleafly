import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCE = /\.(ts|tsx)$/;
const TEST = /\.(test|spec)\.(ts|tsx)$/;
const STATIC_COLLAB_IMPORT =
  /^\s*import\s[^;]*?from\s+["'](?:@\/features\/collab|(?:\.\.?\/)+features\/collab)[^"']*["']/m;
const DYNAMIC_COLLAB_IMPORT = /import\(\s*["']@\/features\/collab\/[^"']+["']\s*\)/;

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const sourcesOutsideCollab = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
  .filter((path) => SOURCE.test(path) && !TEST.test(path))
  .map((path) => join("src", path).split(sep).join("/"))
  .filter((path) => !path.startsWith("src/features/collab/"));

describe("collaboration stays out of the startup bundle", () => {
  it("is never imported statically from outside its folder", () => {
    expect(sourcesOutsideCollab.filter((path) => STATIC_COLLAB_IMPORT.test(read(path)))).toEqual([]);
  });

  it("is loaded only by the Settings modal, which App loads lazily", () => {
    expect(sourcesOutsideCollab.filter((path) => DYNAMIC_COLLAB_IMPORT.test(read(path)))).toEqual([
      "src/components/layout/SettingsModal.tsx",
    ]);
    const app = read("src/App.tsx");
    expect(app).toMatch(/lazy\(\(\) =>\s*import\("@\/components\/layout\/SettingsModal"\)/);
    expect(app).not.toMatch(/from\s+"@\/components\/layout\/SettingsModal"/);
  });

  it("keeps the English collaboration catalog out of the eager catalogs", () => {
    const resources = read("src/i18n/resources.ts");
    expect(resources).not.toMatch(/^import\s+\w+\s+from\s+"\.\/locales\/en\/collab\.json"/m);
    expect(resources).toMatch(/import\("\.\/locales\/en\/collab\.json"\)/);
  });
});
