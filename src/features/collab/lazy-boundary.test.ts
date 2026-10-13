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

  it("is loaded only through its lazy entry points", () => {
    expect(sourcesOutsideCollab.filter((path) => DYNAMIC_COLLAB_IMPORT.test(read(path))).sort()).toEqual([
      "src/components/collab/CollabSlots.tsx",
      "src/components/layout/CollabLinkKeeper.tsx",
      "src/components/layout/CollabLiveKeeper.tsx",
      "src/components/layout/SettingsModal.tsx",
    ]);
    const app = read("src/App.tsx");
    expect(app).toMatch(/lazy\(\(\) =>\s*import\("@\/components\/layout\/SettingsModal"\)/);
    expect(app).not.toMatch(/from\s+"@\/components\/layout\/SettingsModal"/);
  });

  it("opens the admin console window only through the gated collaboration slot", () => {
    const main = read("src/main.tsx");
    expect(main).toMatch(/^import \{ AdminConsoleSlot \} from "@\/components\/collab\/CollabSlots";$/m);
    expect(main).toMatch(/<AdminConsoleSlot \/>/);
    expect(main).not.toMatch(/AdminConsoleWindow/);
  });

  it("hears app links at the root through a keeper that loads the link intake on demand", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/^import \{ CollabLinkKeeper \} from "@\/components\/layout\/CollabLinkKeeper";$/m);
    expect(app).toMatch(/<CollabLinkKeeper \/>/);
    const keeper = read("src/components/layout/CollabLinkKeeper.tsx");
    expect(keeper).toMatch(/lazy\(\(\) =>\s*import\("@\/features\/collab\/links\/LinkIntake"\)/);
    expect(keeper.match(/^import .*$/gm)).toEqual([
      'import { lazy, Suspense, useCallback, useEffect, useState } from "react";',
      'import { isTauri } from "@tauri-apps/api/core";',
      'import { logError } from "@/lib/log";',
      'import { collabPendingLinks, onCollabOpenLink } from "@/lib/tauri";',
    ]);
  });

  it("keeps the English collaboration catalog out of the eager catalogs", () => {
    const resources = read("src/i18n/resources.ts");
    expect(resources).not.toMatch(/^import\s+\w+\s+from\s+"\.\/locales\/en\/collab\.json"/m);
    expect(resources).toMatch(/import\("\.\/locales\/en\/collab\.json"\)/);
  });
});
