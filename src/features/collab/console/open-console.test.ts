import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { server } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  isTauri: true,
  created: [] as { label: string; options: Record<string, unknown>; once: ReturnType<typeof vi.fn> }[],
  existing: new Map<string, { setFocus: ReturnType<typeof vi.fn> }>(),
  monitors: [] as unknown[] | Error,
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => {
    if (mocks.monitors instanceof Error) throw mocks.monitors;
    return mocks.monitors;
  },
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    once = vi.fn();
    static async getByLabel(label: string) {
      return mocks.existing.get(label) ?? null;
    }
    constructor(label: string, options: Record<string, unknown>) {
      mocks.created.push({ label, options, once: this.once });
    }
  },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import {
  CONSOLE_VIEW,
  consoleGeometryKey,
  consoleWindowLabel,
  openAdminConsole,
  readConsoleServerId,
} from "./open-console";

const ID = server().server_id;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  mocks.isTauri = true;
  mocks.created.length = 0;
  mocks.existing.clear();
  mocks.monitors = [];
  mocks.logError.mockReset();
  localStorage.clear();
});

describe("console window naming", () => {
  it("gives each server its own window label", () => {
    expect(consoleWindowLabel(ID)).toBe(`admin-console-${ID}`);
    expect(consoleWindowLabel("a b/c.d")).toBe("admin-console-a-b-c-d");
    expect(consoleGeometryKey(ID)).toBe(`oleafly.console.geometry.${ID}`);
  });

  it("reads the server from the window address", () => {
    expect(CONSOLE_VIEW).toBe("admin");
    expect(readConsoleServerId(`?view=admin&server=${ID}`)).toBe(ID);
    expect(readConsoleServerId("?view=admin&server=")).toBeNull();
    expect(readConsoleServerId("?view=admin")).toBeNull();
  });
});

describe("openAdminConsole", () => {
  it("opens a resizable console window for the server", async () => {
    await openAdminConsole(server());
    expect(mocks.created).toHaveLength(1);
    const [window] = mocks.created;
    expect(window.label).toBe(`admin-console-${ID}`);
    expect(window.options).toMatchObject({
      url: `index.html?view=admin&server=${ID}`,
      title: "Oleafly Server Admin Console",
      width: 1040,
      height: 720,
      minWidth: 560,
      minHeight: 420,
      resizable: true,
      center: true,
      focus: true,
    });
    expect(window.options).not.toHaveProperty("x");
    const onError = window.once.mock.calls[0];
    expect(onError[0]).toBe("tauri://error");
    onError[1]({ payload: "boom" });
    expect(mocks.logError).toHaveBeenCalledWith("admin-console-window", "boom");
  });

  it("brings back the size and place the window had", async () => {
    localStorage.setItem(consoleGeometryKey(ID), JSON.stringify({ x: 100, y: 80, width: 900, height: 640 }));
    mocks.monitors = [{ position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, scaleFactor: 2 }];
    await openAdminConsole(server());
    expect(mocks.created[0].options).toMatchObject({ x: 100, y: 80, width: 900, height: 640, center: false });
  });

  it("centres a window whose screen is gone but keeps its size", async () => {
    localStorage.setItem(consoleGeometryKey(ID), JSON.stringify({ x: -3000, y: 80, width: 900, height: 640 }));
    mocks.monitors = [{ position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, scaleFactor: 2 }];
    await openAdminConsole(server());
    expect(mocks.created[0].options).toMatchObject({ width: 900, height: 640, center: true });
    expect(mocks.created[0].options).not.toHaveProperty("x");
  });

  it("centres the window when the screens cannot be read", async () => {
    localStorage.setItem(consoleGeometryKey(ID), JSON.stringify({ x: 100, y: 80, width: 900, height: 640 }));
    mocks.monitors = new Error("display unavailable");
    await openAdminConsole(server());
    expect(mocks.created[0].options).toMatchObject({ width: 900, height: 640, center: true });
  });

  it("focuses the open console for the same server instead of opening another", async () => {
    const setFocus = vi.fn(async () => {});
    mocks.existing.set(`admin-console-${ID}`, { setFocus });
    await openAdminConsole(server());
    expect(setFocus).toHaveBeenCalledOnce();
    expect(mocks.created).toHaveLength(0);
  });

  it("does nothing outside the desktop app", async () => {
    mocks.isTauri = false;
    await openAdminConsole(server());
    expect(mocks.created).toHaveLength(0);
  });
});
