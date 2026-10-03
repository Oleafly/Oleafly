import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Monitor } from "@tauri-apps/api/window";

const mocks = vi.hoisted(() => ({
  created: [] as { label: string; options: Record<string, unknown> }[],
  existing: new Map<string, { destroy: () => Promise<void> }>(),
  monitors: [] as unknown[],
  current: null as unknown,
  isTauri: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => mocks.monitors,
  currentMonitor: async () => mocks.current,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static async getByLabel(label: string) {
      return mocks.existing.get(label) ?? null;
    }
    constructor(label: string, options: Record<string, unknown>) {
      mocks.created.push({ label, options });
    }
    once() {
      return Promise.resolve(() => {});
    }
  },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { placePresentation, startPresentation } from "./open";
import { readPresentationParams } from "./navigation";

function monitor(x: number, width = 1440, height = 900, scaleFactor = 2): Monitor {
  return {
    name: `m${x}`,
    position: { x: x * scaleFactor, y: 0 },
    size: { width: width * scaleFactor, height: height * scaleFactor },
    scaleFactor,
    workArea: { position: { x: x * scaleFactor, y: 0 }, size: { width: width * scaleFactor, height: height * scaleFactor } },
  } as unknown as Monitor;
}

beforeEach(() => {
  mocks.created.length = 0;
  mocks.existing.clear();
  mocks.monitors = [];
  mocks.current = null;
  mocks.isTauri = true;
});

describe("placePresentation", () => {
  it("puts the slides on another screen when presenting with presenter view", () => {
    const laptop = monitor(0);
    const projector = monitor(1440, 1920, 1080, 1);
    const placement = placePresentation([laptop, projector], laptop, true);
    expect(placement).toEqual({
      audience: { x: 1440, y: 0, width: 1920, height: 1080 },
      presenter: { x: 0, y: 0, width: 1440, height: 900 },
      fullscreen: true,
    });
  });

  it("keeps both windows visible for a rehearsal on one screen", () => {
    const laptop = monitor(0);
    expect(placePresentation([laptop], laptop, true).fullscreen).toBe(false);
    expect(placePresentation([laptop], laptop, false)).toEqual({
      audience: { x: 0, y: 0, width: 1440, height: 900 },
      presenter: null,
      fullscreen: true,
    });
  });
});

describe("startPresentation", () => {
  it("opens a full screen slide window for the compiled PDF", async () => {
    mocks.monitors = [monitor(0)];
    mocks.current = mocks.monitors[0];
    const params = await startPresentation({
      projectId: "deck",
      source: { kind: "compiled" },
      start: 3,
      presenter: false,
      main: "main.typ",
      typst: true,
    });
    expect(mocks.created).toHaveLength(1);
    const [audience] = mocks.created;
    expect(audience.label).toBe("presentation");
    expect(audience.options).toMatchObject({ fullscreen: true, focus: true, x: 0, y: 0, width: 1440, height: 900 });
    const url = String(audience.options.url);
    expect(url.startsWith("index.html?")).toBe(true);
    expect(readPresentationParams(url.slice("index.html".length))).toEqual(params);
    expect(params).toMatchObject({ projectId: "deck", start: 3, presenter: false, typst: true });
  });

  it("adds a presenter window and replaces a running presentation", async () => {
    const destroy = vi.fn(async () => {});
    mocks.existing.set("presentation", { destroy });
    mocks.monitors = [monitor(0), monitor(1440)];
    mocks.current = mocks.monitors[0];
    await startPresentation({
      projectId: "deck",
      source: { kind: "file", path: "beamer.pdf" },
      presenter: true,
      main: null,
      typst: false,
    });
    expect(destroy).toHaveBeenCalled();
    expect(mocks.created.map((window) => window.label)).toEqual(["presentation", "presenter"]);
    expect(mocks.created[0].options).toMatchObject({ fullscreen: true, focus: false, x: 1440 });
    expect(mocks.created[1].options).toMatchObject({ focus: true, x: 40, y: 40 });
    expect(String(mocks.created[1].options.url)).toContain("view=presenter");
    expect(String(mocks.created[1].options.url)).toContain("path=beamer.pdf");
  });

  it("hands the Typst variant and offline mode to both windows", async () => {
    mocks.monitors = [monitor(0)];
    mocks.current = mocks.monitors[0];
    const params = await startPresentation({
      projectId: "deck",
      source: { kind: "compiled" },
      presenter: true,
      main: "main.typ",
      typst: true,
      variant: "review",
      offline: true,
    });
    expect(params).toMatchObject({ variant: "review", offline: true });
    for (const window of mocks.created) {
      const url = String(window.options.url);
      expect(readPresentationParams(url.slice("index.html".length))).toMatchObject({ variant: "review", offline: true });
    }
  });

  it("does nothing outside the desktop app", async () => {
    mocks.isTauri = false;
    expect(
      await startPresentation({ projectId: "deck", source: { kind: "compiled" }, presenter: false, main: null, typst: false }),
    ).toBeNull();
    expect(mocks.created).toHaveLength(0);
  });
});
