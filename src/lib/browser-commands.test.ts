import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  browserBack,
  browserContentVisible,
  browserForward,
  browserNavigate,
  browserReload,
  browserState,
  browserTabActivate,
  browserTabClose,
  browserTabOpen,
  browserWindowClose,
  browserWindowFocus,
  browserWindowOpen,
} from "./browser-commands";

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
});

describe("browser commands", () => {
  it("opens a browser window and returns its label", async () => {
    invoke.mockResolvedValue("browser-1");
    await expect(browserWindowOpen("https://arxiv.org")).resolves.toBe("browser-1");
    expect(invoke).toHaveBeenCalledWith("browser_window_open", { url: "https://arxiv.org" });
  });

  it("returns the browser snapshot from the backend", async () => {
    const snapshot = { window: "browser-1", tabs: [], active: null };
    invoke.mockResolvedValue(snapshot);
    await expect(browserState()).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenCalledWith("browser_state");
  });

  it("opens a tab and returns the new tab label", async () => {
    invoke.mockResolvedValue("tab-2");
    await expect(browserTabOpen("https://example.org")).resolves.toBe("tab-2");
    expect(invoke).toHaveBeenCalledWith("browser_tab_open", { url: "https://example.org" });
  });

  it.each([
    ["browser_window_focus", () => browserWindowFocus("browser-1"), { label: "browser-1" }],
    ["browser_window_close", () => browserWindowClose("browser-1"), { label: "browser-1" }],
    ["browser_tab_activate", () => browserTabActivate("tab-1"), { tab: "tab-1" }],
    ["browser_tab_close", () => browserTabClose("tab-1"), { tab: "tab-1" }],
    ["browser_navigate", () => browserNavigate("tab-1", "https://a.org"), { tab: "tab-1", url: "https://a.org" }],
    ["browser_navigate", () => browserNavigate(null, "https://b.org"), { tab: null, url: "https://b.org" }],
    ["browser_back", () => browserBack("tab-1"), { tab: "tab-1" }],
    ["browser_forward", () => browserForward("tab-1"), { tab: "tab-1" }],
    ["browser_reload", () => browserReload("tab-1"), { tab: "tab-1" }],
    ["browser_content_visible", () => browserContentVisible(false), { visible: false }],
  ] as const)("sends %s with the expected arguments", async (command, call, args) => {
    await expect(call()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(command, args);
  });

  it("propagates backend rejections", async () => {
    invoke.mockRejectedValue("could not focus the browser window");
    await expect(browserWindowFocus("gone")).rejects.toBe("could not focus the browser window");
  });
});
