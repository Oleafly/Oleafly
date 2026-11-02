// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIconPackState, setIconPack, setInstalledIconPack } from "@/components/icons/icon-pack";
import { COLOR_ICON_PREVIEW } from "@/components/settings/icon-pack-preview";
import {
  colorIconPackStored,
  downloadColorIconPack,
  IconPackError,
  loadStoredColorIconPack,
  parseIconPack,
  removeColorIconPack,
} from "./icon-pack-install";

// The built pack is not in the repository, so the tests pin the preview as if it were the pack.
vi.mock("@/lib/icon-pack-pin", async () => {
  const { createHash } = await import("node:crypto");
  const { COLOR_ICON_PREVIEW: text } = await import("@/components/settings/icon-pack-preview");
  return {
    COLOR_ICON_PACK: { file: "oleafly-color.json", version: 1, bytes: text.length, sha256: createHash("sha256").update(text).digest("hex") },
  };
});

const STORAGE_KEY = "oleafly.iconPack.color";
const pack = () => JSON.parse(COLOR_ICON_PREVIEW) as { css: string; defs: string; icons: Record<string, string> };
const respond = (body: string, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 404, text: async () => body }));

beforeEach(() => {
  localStorage.clear();
  setInstalledIconPack(null);
  setIconPack("neutral");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("turns gradient stops into React style objects", () => {
    const stops = JSON.stringify(parseIconPack(COLOR_ICON_PREVIEW).defs);
    expect(stops).toContain('"stopColor":"var(--oi-');
  });

  it("refuses a pack that tries to load a script or a remote stylesheet", () => {
    const withScript = { ...pack(), icons: { ...pack().icons, folder: "<script>alert(1)</script>" } };
    const withImport = { ...pack(), css: `@import url("https://example.com/x.css");${pack().css}` };
    for (const tampered of [withScript, withImport]) {
      expect(() => parseIconPack(JSON.stringify(tampered))).toThrow(IconPackError);
    }
  });

  it.each([
    ["text that is not JSON", "{"],
    ["another format", JSON.stringify({ ...pack(), format: 2 })],
    ["icons that are not an object", JSON.stringify({ ...pack(), icons: null })],
    ["an icon name with odd characters", JSON.stringify({ ...pack(), icons: { "Folder!": "<path d='M0 0'/>" } })],
    ["an attribute outside the list", JSON.stringify({ ...pack(), icons: { folder: "<path d='M0 0' onclick='x()'/>" } })],
    ["a value that breaks its attribute's pattern", JSON.stringify({ ...pack(), icons: { folder: "<path fill='red'/>" } })],
    ["a style anywhere but a gradient stop", JSON.stringify({ ...pack(), icons: { folder: "<path style='fill:red'/>" } })],
    ["a stop colour that is not a pack token", JSON.stringify({ ...pack(), defs: "<linearGradient id='oi-g-x'><stop style='stop-color:red'/></linearGradient>" })],
    ["markup that is not well formed", JSON.stringify({ ...pack(), icons: { folder: "<path d='M0 0'>" } })],
  ])("refuses %s", (_case, text) => {
    expect(() => parseIconPack(text)).toThrow(IconPackError);
  });
});

describe("colour icon pack download", () => {
  it("installs a download that matches the pinned hash and keeps it for the next start", async () => {
    vi.stubGlobal("fetch", respond(COLOR_ICON_PREVIEW));
    await downloadColorIconPack();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(COLOR_ICON_PREVIEW);
    expect(colorIconPackStored()).toBe(true);
    expect(Object.keys(getIconPackState().installed?.icons ?? {})).toContain("folder");
  });

  it("reports a network failure when the server refuses or cannot be reached", async () => {
    vi.stubGlobal("fetch", respond("", false));
    await expect(downloadColorIconPack()).rejects.toMatchObject({ reason: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(downloadColorIconPack()).rejects.toMatchObject({ reason: "network" });
    expect(colorIconPackStored()).toBe(false);
  });

  it("refuses a download whose hash does not match, and stores nothing", async () => {
    vi.stubGlobal("fetch", respond(JSON.stringify({ ...pack(), css: `${pack().css}\n` })));
    await expect(downloadColorIconPack()).rejects.toMatchObject({ reason: "integrity" });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getIconPackState().installed).toBeNull();
  });
});

describe("stored colour icon pack", () => {
  it("installs the stored pack at startup", async () => {
    localStorage.setItem(STORAGE_KEY, COLOR_ICON_PREVIEW);
    await loadStoredColorIconPack();
    expect(getIconPackState().installed).not.toBeNull();
  });

  it("drops a stored pack built for another version of the app", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pack(), version: 0 }));
    await loadStoredColorIconPack();
    expect(getIconPackState().installed).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does nothing when no pack is stored", async () => {
    await loadStoredColorIconPack();
    expect(getIconPackState().installed).toBeNull();
  });

  it("removes the stored pack and the installed drawings", async () => {
    vi.stubGlobal("fetch", respond(COLOR_ICON_PREVIEW));
    await downloadColorIconPack();
    removeColorIconPack();
    expect(colorIconPackStored()).toBe(false);
    expect(getIconPackState().installed).toBeNull();
  });
});
