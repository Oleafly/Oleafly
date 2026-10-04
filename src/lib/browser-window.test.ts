import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tauri: true }));
const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    }),
    browserWindowOpen: vi.fn(async () => "oleafly-browser-window-1"),
    browserWindowFocus: vi.fn(async () => {}),
    browserWindowClose: vi.fn(async () => {}),
    browserNavigate: vi.fn(async () => {}),
    registerCuaSurface: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/browser-commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/browser-commands")>(
    "@/lib/browser-commands",
  );
  return {
    BROWSER_EVENTS: actual.BROWSER_EVENTS,
    browserWindowOpen: mocks.browserWindowOpen,
    browserWindowFocus: mocks.browserWindowFocus,
    browserWindowClose: mocks.browserWindowClose,
    browserNavigate: mocks.browserNavigate,
  };
});
vi.mock("@/lib/cua-sandbox", () => ({ registerCuaSurface: mocks.registerCuaSurface }));

import {
  closeBrowserWindow,
  focusBrowserWindow,
  launchBrowser,
  openBrowserWindow,
  registerBrowserCuaSurface,
  toggleBrowser,
} from "./browser-window";
import { useSettingsStore } from "@/store/settings";

type Surface = {
  url: () => string;
  navigate: (url: string) => Promise<void> | void;
  document: Document;
};

function lastSurface(): Surface {
  const calls = mocks.registerCuaSurface.mock.calls;
  return calls[calls.length - 1][0] as Surface;
}

function fire(name: string, payload: unknown) {
  const handler = mocks.listeners.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
}

describe("browser-window launcher", () => {
  beforeEach(async () => {
    state.tauri = true;
    for (const fn of Object.values(mocks)) {
      if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
    }
    mocks.browserWindowOpen.mockResolvedValue("oleafly-browser-window-1");
    useSettingsStore.setState({
      webBrowser: true,
      browserOpen: false,
      browserHomePage: "https://home.test/",
    });
    await closeBrowserWindow();
    mocks.browserWindowClose.mockClear();
  });

  it("opens the window through the backend and remembers its label", async () => {
    await expect(openBrowserWindow("https://example.com/")).resolves.toBe(true);
    expect(mocks.browserWindowOpen).toHaveBeenCalledWith("https://example.com/");
    await expect(focusBrowserWindow()).resolves.toBe(true);
    expect(mocks.browserWindowFocus).toHaveBeenCalledWith("oleafly-browser-window-1");
    await closeBrowserWindow();
    expect(mocks.browserWindowClose).toHaveBeenCalledWith("oleafly-browser-window-1");
    await expect(focusBrowserWindow()).resolves.toBe(false);
  });

  it("reports failure when the backend refuses", async () => {
    mocks.browserWindowOpen.mockRejectedValueOnce(new Error("bad url"));
    await expect(openBrowserWindow("https://example.com/")).resolves.toBe(false);
    await expect(focusBrowserWindow()).resolves.toBe(false);
  });

  it("falls back to window.open outside Tauri", async () => {
    state.tauri = false;
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("window", { open });
    await expect(openBrowserWindow("https://example.com/")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
    expect(mocks.browserWindowOpen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("launches the home page and respects the experimental flag", async () => {
    launchBrowser();
    await vi.waitFor(() =>
      expect(mocks.browserWindowOpen).toHaveBeenCalledWith("https://home.test/"),
    );
    expect(useSettingsStore.getState().browserOpen).toBe(true);
    mocks.browserWindowOpen.mockClear();
    useSettingsStore.setState({ webBrowser: false, browserOpen: false });
    launchBrowser("https://example.com/");
    expect(mocks.browserWindowOpen).not.toHaveBeenCalled();
  });

  it("toggles the window closed and open", async () => {
    toggleBrowser();
    await vi.waitFor(() => expect(mocks.browserWindowOpen).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().browserOpen).toBe(true);
    toggleBrowser();
    expect(useSettingsStore.getState().browserOpen).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.browserWindowClose).toHaveBeenCalledWith("oleafly-browser-window-1"),
    );
  });

  it("turns the toggle off when the backend reports the window closed", async () => {
    await openBrowserWindow("https://example.com/");
    useSettingsStore.setState({ browserOpen: true });
    fire("browser-window-closed", { label: "some-other-window" });
    expect(useSettingsStore.getState().browserOpen).toBe(true);
    fire("browser-window-closed", { label: "oleafly-browser-window-1" });
    expect(useSettingsStore.getState().browserOpen).toBe(false);
    await expect(focusBrowserWindow()).resolves.toBe(false);
  });

  it("adopts a home page chosen inside the browser window", async () => {
    await openBrowserWindow("https://example.com/");
    fire("browser-home-page", { url: "https://new-home.test/" });
    expect(useSettingsStore.getState().browserHomePage).toBe("https://new-home.test/");
  });

  it("routes CUA navigation to the active tab once the window exists", async () => {
    const dispose = registerBrowserCuaSurface();
    const surface = lastSurface();
    await surface.navigate("https://first.test/");
    expect(mocks.browserWindowOpen).toHaveBeenCalledWith("https://first.test/");
    expect(surface.url()).toBe("https://first.test/");

    await surface.navigate("https://second.test/");
    expect(mocks.browserNavigate).toHaveBeenCalledWith(null, "https://second.test/");
    expect(mocks.browserWindowOpen).toHaveBeenCalledTimes(1);

    fire("browser-page-load", {
      label: "oleafly-browser-pane-1",
      state: "finished",
      url: "https://second.test/landed",
      active: true,
    });
    expect(surface.url()).toBe("https://second.test/landed");
    fire("browser-page-load", {
      label: "oleafly-browser-pane-2",
      state: "finished",
      url: "https://background.test/",
      active: false,
    });
    expect(surface.url()).toBe("https://second.test/landed");
    expect(() => surface.document).toThrow();

    dispose();
    expect(mocks.registerCuaSurface).toHaveBeenLastCalledWith(null);
  });

  it("reopens the window when navigation fails because it is gone", async () => {
    registerBrowserCuaSurface();
    const surface = lastSurface();
    await surface.navigate("https://first.test/");
    mocks.browserNavigate.mockRejectedValueOnce(new Error("the browser window is not open"));
    await surface.navigate("https://second.test/");
    expect(mocks.browserWindowOpen).toHaveBeenLastCalledWith("https://second.test/");
  });

  it("tracks the URL of a tab brought to the front", async () => {
    registerBrowserCuaSurface();
    const surface = lastSurface();
    await openBrowserWindow("https://example.com/");
    fire("browser-tab-activated", { label: "tab-2", url: "https://tab.test/" });
    expect(surface.url()).toBe("https://tab.test/");
    fire("browser-tab-activated", { label: "tab-3" });
    expect(surface.url()).toBe("https://tab.test/");
  });

  it("focuses an existing window instead of opening another and forgets it when focus fails", async () => {
    await openBrowserWindow("https://example.com/");
    launchBrowser();
    await vi.waitFor(() => expect(mocks.browserWindowFocus).toHaveBeenCalledWith("oleafly-browser-window-1"));
    expect(mocks.browserWindowOpen).toHaveBeenCalledTimes(1);

    mocks.browserWindowFocus.mockRejectedValueOnce(new Error("window gone"));
    await expect(focusBrowserWindow()).resolves.toBe(false);
    await expect(focusBrowserWindow()).resolves.toBe(false);
    expect(mocks.browserWindowFocus).toHaveBeenCalledTimes(2);
  });

  it("opens the default home page when none is set and does nothing with the browser off", async () => {
    useSettingsStore.setState({ browserHomePage: "" });
    launchBrowser();
    await vi.waitFor(() => expect(mocks.browserWindowOpen).toHaveBeenCalledWith("https://www.google.com"));

    useSettingsStore.setState({ webBrowser: false, browserOpen: false });
    toggleBrowser();
    expect(useSettingsStore.getState().browserOpen).toBe(false);
    expect(mocks.browserWindowOpen).toHaveBeenCalledTimes(1);
  });
});

describe("browser-window listener installation", () => {
  it("retries installing the event listeners after a failure", async () => {
    vi.resetModules();
    state.tauri = true;
    mocks.listen.mockClear();
    mocks.listen.mockRejectedValueOnce(new Error("no event bus"));
    const fresh = await import("./browser-window");
    await expect(fresh.openBrowserWindow("https://example.com/")).resolves.toBe(true);
    await fresh.openBrowserWindow("https://example.com/again");
    expect(mocks.listen).toHaveBeenCalledTimes(8);
    await fresh.openBrowserWindow("https://example.com/third");
    expect(mocks.listen).toHaveBeenCalledTimes(8);
  });
});
