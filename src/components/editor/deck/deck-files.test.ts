import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ readFileBase64: vi.fn() }));
vi.mock("@/lib/tauri", () => tauri);
const log = vi.hoisted(() => ({ logWarning: vi.fn(async () => undefined) }));
vi.mock("@/lib/log", () => log);

import { deckAssetImports, readDeckAssets, resolveDeckImport } from "./deck-files";
import { isDeckPath } from "./deck-path";

beforeEach(() => {
  tauri.readFileBase64.mockReset();
  log.logWarning.mockClear();
});

describe("isDeckPath", () => {
  it("matches the index file of a folder under slides", () => {
    expect(isDeckPath("slides/talk/index.tsx")).toBe(true);
    expect(isDeckPath("papers/slides/talk/index.tsx")).toBe(true);
    expect(isDeckPath("slides/index.tsx")).toBe(false);
    expect(isDeckPath("slides/talk/intro.tsx")).toBe(false);
    expect(isDeckPath("slides/talk/nested/index.tsx")).toBe(false);
    expect(isDeckPath("myslides/talk/index.tsx")).toBe(false);
    expect(isDeckPath(null)).toBe(false);
  });
});

describe("resolveDeckImport", () => {
  it("resolves relative and @assets imports inside the project", () => {
    expect(resolveDeckImport("slides/talk/index.tsx", "./figure.png")).toBe("slides/talk/figure.png");
    expect(resolveDeckImport("slides/talk/index.tsx", "../shared/logo.svg")).toBe("slides/shared/logo.svg");
    expect(resolveDeckImport("slides/talk/index.tsx", "@assets/cover.jpg")).toBe("assets/cover.jpg");
  });

  it("refuses imports that climb out of the project", () => {
    expect(resolveDeckImport("slides/talk/index.tsx", "../../../secret.png")).toBeNull();
    expect(resolveDeckImport("slides/talk/index.tsx", "@assets/../../x.png")).toBeNull();
    expect(resolveDeckImport("slides/talk/index.tsx", "../../")).toBeNull();
  });

  it("reads Windows separators and drops empty and current-folder parts", () => {
    expect(resolveDeckImport("slides/talk/index.tsx", ".\\figures\\plot.png")).toBe("slides/talk/figures/plot.png");
    expect(resolveDeckImport("index.tsx", "./cover.png")).toBe("cover.png");
    expect(resolveDeckImport("slides/talk/index.tsx", "@assets//./logo.svg")).toBe("assets/logo.svg");
  });
});

describe("deckAssetImports", () => {
  it("collects image imports and skips code and packages", () => {
    const code = [
      'import cover from "./cover.png";',
      "import chart from '@assets/chart.svg';",
      'import { Steps } from "@open-slide/core";',
      'import helper from "./helper";',
      'import escape from "../../../../etc.png";',
    ].join("\n");
    expect([...deckAssetImports("slides/talk/index.tsx", code)]).toEqual([
      ["./cover.png", "slides/talk/cover.png"],
      ["@assets/chart.svg", "assets/chart.svg"],
    ]);
  });
});

describe("readDeckAssets", () => {
  it("turns each image into a data URL and drops the ones that fail to read", async () => {
    tauri.readFileBase64.mockImplementation((_project?: string, path?: string) =>
      path?.endsWith("missing.png") ? Promise.reject(new Error("gone")) : Promise.resolve("AAAA"),
    );
    const assets = await readDeckAssets(
      "p1",
      new Map([
        ["./cover.png", "slides/talk/cover.png"],
        ["./missing.png", "slides/talk/missing.png"],
      ]),
    );
    expect(assets).toEqual({ "./cover.png": "data:image/png;base64,AAAA" });
    expect(tauri.readFileBase64).toHaveBeenCalledWith("p1", "slides/talk/cover.png");
    expect(log.logWarning).toHaveBeenCalledExactlyOnceWith("read the slide image slides/talk/missing.png", expect.any(Error));
  });
});
