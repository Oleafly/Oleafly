// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => ({ openInSystemBrowser: vi.fn() }));
vi.mock("@/lib/system-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-browser")>()),
  openInSystemBrowser: browser.openInSystemBrowser,
}));
const log = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => log);

import { PREVIEW_LINK_MESSAGE, PreviewFrame } from "./PreviewFrame";

const ORIGIN = "http://127.0.0.1:4100";
const SRC = `${ORIGIN}/t0k3n/site/index.html?v=1`;
const TITLE = "index.html";

function shown() {
  render(<PreviewFrame src={SRC} title={TITLE} />);
  const frame = screen.getByTitle(TITLE) as HTMLIFrameElement;
  frame.tabIndex = 0;
  return frame;
}

function post(
  frame: HTMLIFrameElement,
  data: unknown,
  { origin = ORIGIN, source = frame.contentWindow }: { origin?: string; source?: Window | null } = {},
) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

const link = (url: string) => ({ type: PREVIEW_LINK_MESSAGE, url });

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "userActivation");
});

function activation(isActive: boolean) {
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive } });
}

describe("PreviewFrame", () => {
  it("opens a link the page hands over in the browser while the page has focus", async () => {
    browser.openInSystemBrowser.mockResolvedValue(true);
    const frame = shown();
    frame.focus();
    post(frame, link("https://example.com/paper?id=1"));
    await waitFor(() => expect(browser.openInSystemBrowser).toHaveBeenCalledWith("https://example.com/paper?id=1"));
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("ignores messages that are not a link click from its own page", () => {
    const frame = shown();
    frame.focus();
    post(frame, link("https://example.com/"), { origin: "http://127.0.0.1:4101" });
    post(frame, link("https://example.com/"), { source: window });
    post(frame, link("javascript:alert(1)"));
    post(frame, link("file:///etc/passwd"));
    post(frame, { type: "something-else", url: "https://example.com/" });
    post(frame, "https://example.com/");
    post(frame, null);
    expect(browser.openInSystemBrowser).not.toHaveBeenCalled();
  });

  it("opens a link only right after the reader acted in the page, where the webview can tell", async () => {
    browser.openInSystemBrowser.mockResolvedValue(true);
    const frame = shown();
    frame.focus();
    activation(false);
    post(frame, link("https://example.com/on-its-own"));
    expect(browser.openInSystemBrowser).not.toHaveBeenCalled();
    activation(true);
    post(frame, link("https://example.com/clicked"));
    await waitFor(() => expect(browser.openInSystemBrowser).toHaveBeenCalledExactlyOnceWith("https://example.com/clicked"));
  });

  it("opens nothing when the page asks without having focus", () => {
    const frame = shown();
    post(frame, link("https://example.com/"));
    expect(browser.openInSystemBrowser).not.toHaveBeenCalled();
  });

  it("opens one link a second however often the page asks", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    browser.openInSystemBrowser.mockResolvedValue(true);
    const frame = shown();
    frame.focus();
    post(frame, link("https://example.com/1"));
    post(frame, link("https://example.com/2"));
    expect(browser.openInSystemBrowser).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    post(frame, link("https://example.com/3"));
    expect(browser.openInSystemBrowser).toHaveBeenLastCalledWith("https://example.com/3");
    expect(browser.openInSystemBrowser).toHaveBeenCalledTimes(2);
  });

  it("logs the site of a link the browser could not open", async () => {
    browser.openInSystemBrowser.mockResolvedValue(false);
    const frame = shown();
    frame.focus();
    post(frame, link("https://example.com/secret?token=1"));
    await waitFor(() =>
      expect(log.logError).toHaveBeenCalledWith("open a link from an HTML preview", "https://example.com did not open"),
    );
  });

  it("stops listening once it is gone", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<PreviewFrame src={SRC} title={TITLE} />);
    unmount();
    expect(removeListener).toHaveBeenCalledWith("message", expect.any(Function));
    removeListener.mockRestore();
  });
});
