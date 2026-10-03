import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("warmChoiceArt", () => {
  it("reads every illustration once, when the app is idle", async () => {
    const idle: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle.push(callback);
      return idle.length;
    });
    const sources: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        set src(value: string) {
          sources.push(value);
        }
        decode() {
          return Promise.reject(new Error("not in jsdom"));
        }
      },
    );
    const { CHOICE_ART, warmChoiceArt } = await import("@/components/library/choice-art");

    warmChoiceArt();
    warmChoiceArt();
    expect(sources).toEqual([]);
    expect(idle).toHaveLength(1);

    idle[0]({ didTimeout: false, timeRemaining: () => 50 });
    expect(sources).toEqual(Object.values(CHOICE_ART));
  });
});

describe("CHOICE_ART", () => {
  it("registers the three diagram composer pictures", async () => {
    const { CHOICE_ART } = await import("@/components/library/choice-art");
    expect(CHOICE_ART).toMatchObject({
      diagramTikz: "/project-kind/diagram-tikz-light.webp",
      diagramTypst: "/project-kind/diagram-typst-light.webp",
      diagramMermaid: "/project-kind/diagram-mermaid-light.webp",
    });
  });

  it("points every picture at a bundled WebP of 5 to 15 KB", async () => {
    const { CHOICE_ART } = await import("@/components/library/choice-art");
    for (const src of Object.values(CHOICE_ART)) {
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), src).toBe(true);
      const size = statSync(file).size;
      expect(size, src).toBeGreaterThanOrEqual(5 * 1024);
      expect(size, src).toBeLessThanOrEqual(15 * 1024);
    }
  });
});
