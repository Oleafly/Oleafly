// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireNativeWebviewOcclusion } from "@/lib/native-webview-occlusion";
import { BROWSER_SEARCH_ENGINES, useSettingsStore } from "@/store/settings";
import { BrowserPane } from "./BrowserPane";

type BrowserPageLoadPayload = {
  label: string;
  state: "started" | "finished";
  url: string;
};

const tauri = vi.hoisted(() => ({
  enabled: false,
  webviews: [] as Array<{
    label: string;
    options: {
      url: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    events: Map<string, (event: { payload: unknown }) => void>;
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
  }>,
  unlistens: [] as Array<ReturnType<typeof vi.fn>>,
  resolveUnlistens: [] as Array<() => void>,
  deferEventListen: false,
  eventListenFailure: null as Error | null,
  resolveEventListens: [] as Array<() => void>,
  eventListeners: new Map<
    string,
    Set<(event: { payload: BrowserPageLoadPayload }) => void>
  >(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.enabled,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: class {
    label: string;
    show = vi.fn(async () => {});
    hide = vi.fn(async () => {});
    close = vi.fn(async () => {});
    setPosition = vi.fn(async () => {});
    setSize = vi.fn(async () => {});

    constructor(
      _window: unknown,
      label: string,
      options: {
        url: string;
        x: number;
        y: number;
        width: number;
        height: number;
      },
    ) {
      this.label = label;
      this.options = options;
      tauri.webviews.push(this);
    }

    options: {
      url: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    events = new Map<string, (event: { payload: unknown }) => void>();

    once(event: string, callback: (event: { payload: unknown }) => void) {
      this.events.set(event, callback);
      const unlisten = vi.fn();
      tauri.unlistens.push(unlisten);
      if (event === "tauri://created") {
        queueMicrotask(() => callback({ payload: null }));
      }
      return new Promise<() => void>((resolve) => {
        tauri.resolveUnlistens.push(() => resolve(unlisten));
      });
    }
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      event: string,
      callback: (event: { payload: BrowserPageLoadPayload }) => void,
    ) => {
      if (tauri.eventListenFailure) return Promise.reject(tauri.eventListenFailure);
      const register = () => {
        const listeners = tauri.eventListeners.get(event) ?? new Set();
        listeners.add(callback);
        tauri.eventListeners.set(event, listeners);
        const unlisten = vi.fn(() => listeners.delete(callback));
        tauri.unlistens.push(unlisten);
        return unlisten;
      };
      if (!tauri.deferEventListen) return Promise.resolve(register());
      return new Promise<() => void>((resolve) => {
        tauri.resolveEventListens.push(() => resolve(register()));
      });
    },
  ),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    const listen = () => {
      const unlisten = vi.fn();
      tauri.unlistens.push(unlisten);
      return new Promise<() => void>((resolve) => {
        tauri.resolveUnlistens.push(() => resolve(unlisten));
      });
    };
    return {
      onMoved: vi.fn(listen),
      onResized: vi.fn(listen),
    };
  },
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

describe("BrowserPane", () => {
  const occlusionReleases: Array<() => void> = [];

  beforeEach(() => {
    tauri.enabled = false;
    tauri.webviews.length = 0;
    tauri.unlistens.length = 0;
    tauri.resolveUnlistens.length = 0;
    tauri.deferEventListen = false;
    tauri.eventListenFailure = null;
    tauri.resolveEventListens.length = 0;
    tauri.eventListeners.clear();
    useSettingsStore.setState({
      browserSearchEngine: "google",
      browserHomePage: "",
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    for (const release of occlusionReleases.splice(0)) release();
    vi.restoreAllMocks();
  });

  const emitPageLoad = (payload: BrowserPageLoadPayload) => {
    for (const listener of tauri.eventListeners.get("browser-page-load") ?? []) {
      listener({ payload });
    }
  };

  it("does not load the configured home page until the dock is visible", async () => {
    useSettingsStore.setState({ browserHomePage: "https://example.com/start" });
    const view = render(<BrowserPane visible={false} />);
    expect(screen.getByLabelText("Browser address")).toBeInTheDocument();
    expect(screen.queryByTitle("Dock browser")).not.toBeInTheDocument();

    view.rerender(<BrowserPane visible />);

    const frame = (await screen.findByTitle("Dock browser")) as HTMLIFrameElement;
    expect(frame.src).toBe("https://example.com/start");
  });

  it("uses the meridian-line globe in the browser header", () => {
    const { container } = render(<BrowserPane visible={false} />);
    expect(container.querySelector(".lucide-globe")).toBeInTheDocument();
    expect(container.querySelector(".lucide-earth")).not.toBeInTheDocument();
  });

  it("normalizes and opens plain addresses as https", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "arxiv.org/abs/2401.00001" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const frame = screen.getByTitle("Dock browser") as HTMLIFrameElement;
    expect(frame.src).toBe("https://arxiv.org/abs/2401.00001");
  });

  it.each(["Enter", "Open"] as const)(
    "searches plain text with the configured engine using %s",
    (trigger) => {
      useSettingsStore.setState({ browserSearchEngine: "duckduckgo" });
      render(<BrowserPane />);
      const input = screen.getByLabelText("Browser address");
      fireEvent.change(input, { target: { value: "tauri child webview z order" } });
      if (trigger === "Enter") fireEvent.keyDown(input, { key: "Enter" });
      else fireEvent.click(screen.getByRole("button", { name: "Open" }));

      const frame = screen.getByTitle("Dock browser") as HTMLIFrameElement;
      expect(frame.src).toBe(
        "https://duckduckgo.com/?q=tauri%20child%20webview%20z%20order",
      );
    },
  );

  it.each(BROWSER_SEARCH_ENGINES)(
    "uses the $name search URL from the engine catalog",
    ({ id, searchUrl }) => {
      useSettingsStore.setState({ browserSearchEngine: id });
      render(<BrowserPane />);
      const input = screen.getByLabelText("Browser address");
      fireEvent.change(input, { target: { value: "privacy research" } });
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      const frame = screen.getByTitle("Dock browser") as HTMLIFrameElement;
      expect(frame.src).toBe(`${searchUrl}privacy%20research`);
    },
  );

  it("does not enter a loading state when the current address is opened again", () => {
    render(<BrowserPane />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.load(screen.getByTitle("Dock browser"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("rejects non-http schemes", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "file:///etc/passwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByTitle("Dock browser")).not.toBeInTheDocument();
  });

  it.each(["load", "error"] as const)(
    "clears the iframe loading indicator after %s",
    (event) => {
      render(<BrowserPane />);
      fireEvent.change(screen.getByLabelText("Browser address"), {
        target: { value: "example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(screen.getByRole("status")).toHaveTextContent("Loading page");
      fireEvent[event](screen.getByTitle("Dock browser"));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("keeps the native pane hidden until its page finishes loading", async () => {
    tauri.enabled = true;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    expect(pane.options).toMatchObject({
      x: -10_000,
      y: -10_000,
      width: 80,
      height: 80,
    });
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalled());
    expect(pane.show).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading page");

    emitPageLoad({
      label: pane.label,
      state: "finished",
      url: "https://example.com/",
    });

    await vi.waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(1));
    expect(pane.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
      pane.show.mock.invocationCallOrder[0],
    );
    expect(pane.setSize.mock.invocationCallOrder[0]).toBeLessThan(
      pane.show.mock.invocationCallOrder[0],
    );

    emitPageLoad({
      label: pane.label,
      state: "started",
      url: "https://example.com/next",
    });

    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading page"));
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalledTimes(2));
  });

  it("tracks an in-page navigation from the settled page-load URL", async () => {
    tauri.enabled = true;
    render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];

    // The page navigates itself (a link click) to a URL the address bar
    // never typed. The settled page-load event must update the tracked URL.
    emitPageLoad({
      label: pane.label,
      state: "finished",
      url: "https://example.com/deep/article",
    });

    await vi.waitFor(() =>
      expect(screen.getByLabelText("Browser address")).toHaveValue(
        "https://example.com/deep/article",
      ),
    );
  });

  it("waits for page-load monitoring before creating the native pane", async () => {
    tauri.enabled = true;
    tauri.deferEventListen = true;
    useSettingsStore.setState({ browserHomePage: "https://example.com/start" });
    render(<BrowserPane visible />);

    await vi.waitFor(() => expect(tauri.resolveEventListens).toHaveLength(1));
    expect(tauri.webviews).toHaveLength(0);

    tauri.resolveEventListens[0]();

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
  });

  it("falls back to an iframe when page-load monitoring fails", async () => {
    tauri.enabled = true;
    tauri.eventListenFailure = new Error("event permission denied");
    render(<BrowserPane visible />);

    await screen.findByTestId("dock-browser-error");
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const frame = (await screen.findByTitle("Dock browser")) as HTMLIFrameElement;
    expect(frame.src).toBe("https://example.com/");
    expect(screen.getByTestId("dock-browser-error")).toHaveTextContent(
      "event permission denied",
    );
    expect(tauri.webviews).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Loading page");

    fireEvent.load(frame);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps iframe fallback active after a native creation error", async () => {
    tauri.enabled = true;
    render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    pane.events.get("tauri://error")?.({
      payload: { message: "native webview unavailable" },
    });

    const frame = (await screen.findByTitle("Dock browser")) as HTMLIFrameElement;
    fireEvent.load(frame);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const nextFrame = await vi.waitFor(() => {
      const currentFrame = screen.getByTitle("Dock browser") as HTMLIFrameElement;
      expect(currentFrame.src).toBe("https://example.org/");
      return currentFrame;
    });
    expect(tauri.webviews).toHaveLength(1);
    expect(screen.getByTestId("dock-browser-error")).toHaveTextContent(
      "native webview unavailable",
    );
    fireEvent.load(nextFrame);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores page-load events from a replaced native pane", async () => {
    tauri.enabled = true;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    emitPageLoad({
      label: "oleafly-browser-pane-stale",
      state: "finished",
      url: "https://stale.example/",
    });

    expect(screen.getByRole("status")).toHaveTextContent("Loading page");
    expect(pane.show).not.toHaveBeenCalled();
  });

  it("hides the native pane while an app overlay is open", async () => {
    tauri.enabled = true;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    const view = render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    emitPageLoad({
      label: pane.label,
      state: "finished",
      url: "https://example.com/",
    });
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(1));

    const release = acquireNativeWebviewOcclusion();
    occlusionReleases.push(release);
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalledTimes(2));

    release();
    occlusionReleases.pop();
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(2));

    view.rerender(<BrowserPane visible={false} />);
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalledTimes(3));
    const collapsedShowCount = pane.show.mock.calls.length;
    const releaseWhileCollapsed = acquireNativeWebviewOcclusion();
    occlusionReleases.push(releaseWhileCollapsed);
    releaseWhileCollapsed();
    occlusionReleases.pop();
    await Promise.resolve();
    expect(pane.show).toHaveBeenCalledTimes(collapsedShowCount);
  });

  it("hides and restores the native pane without closing it", async () => {
    tauri.enabled = true;
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    const view = render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    emitPageLoad({
      label: pane.label,
      state: "finished",
      url: "https://example.com/",
    });
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(1));

    view.rerender(<BrowserPane visible={false} />);
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalledTimes(2));
    expect(pane.close).not.toHaveBeenCalled();

    view.rerender(<BrowserPane visible />);
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tauri.unlistens).toHaveLength(5));
    expect(pane.setPosition).toHaveBeenCalled();
    expect(pane.setSize).toHaveBeenCalled();
    expect(pane.close).not.toHaveBeenCalled();
    for (const unlisten of tauri.unlistens) expect(unlisten).not.toHaveBeenCalled();

    view.unmount();
    await vi.waitFor(() => expect(pane.close).toHaveBeenCalledTimes(1));
    for (const resolve of tauri.resolveUnlistens.splice(0)) resolve();
    await vi.waitFor(() => {
      for (const unlisten of tauri.unlistens) expect(unlisten).toHaveBeenCalledTimes(1);
    });
    bounds.mockRestore();
  });

  it("applies the latest native visibility after a slow hide", async () => {
    tauri.enabled = true;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    render(<BrowserPane visible />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await vi.waitFor(() => expect(tauri.webviews).toHaveLength(1));
    const pane = tauri.webviews[0];
    emitPageLoad({
      label: pane.label,
      state: "finished",
      url: "https://example.com/",
    });
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(1));

    let finishHide: (() => void) | undefined;
    let nativeVisible = true;
    pane.show.mockImplementation(async () => {
      nativeVisible = true;
    });
    pane.hide.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishHide = () => {
            nativeVisible = false;
            resolve();
          };
        }),
    );
    const release = acquireNativeWebviewOcclusion();
    occlusionReleases.push(release);
    await vi.waitFor(() => expect(finishHide).toBeTypeOf("function"));

    release();
    occlusionReleases.pop();
    await Promise.resolve();
    finishHide?.();

    await vi.waitFor(() => expect(nativeVisible).toBe(true));
    expect(pane.show).toHaveBeenCalledTimes(2);
  });
});
