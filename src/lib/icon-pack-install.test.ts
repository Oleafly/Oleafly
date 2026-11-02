// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { COLOR_ICON_PREVIEW } from "@/components/settings/icon-pack-preview";
import { IconPackError, parseIconPack } from "./icon-pack-install";

describe("colour icon pack parsing", () => {
  it("reads the preview that ships with the app, without the rule that restyles every Lucide icon", () => {
    const preview = parseIconPack(COLOR_ICON_PREVIEW);
    expect(Object.keys(preview.icons)).toEqual([
      "folder",
      "search",
      "settings",
      "assistant",
      "source-control",
      "research",
      "figure",
      "terminal",
    ]);
    expect(preview.defs.length).toBeGreaterThan(0);
    expect(preview.css).toContain(".oi .o");
    expect(preview.css).not.toContain("svg.lucide");
  });

  it("refuses a pack that tries to load a script or a remote stylesheet", () => {
    const pack = JSON.parse(COLOR_ICON_PREVIEW) as { css: string; icons: Record<string, string> };
    const withScript = { ...pack, icons: { ...pack.icons, folder: "<script>alert(1)</script>" } };
    const withImport = { ...pack, css: `@import url("https://example.com/x.css");${pack.css}` };
    for (const tampered of [withScript, withImport]) {
      expect(() => parseIconPack(JSON.stringify(tampered))).toThrow(IconPackError);
    }
  });
});
