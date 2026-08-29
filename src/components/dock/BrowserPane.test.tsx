// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";

const tauri = vi.hoisted(() => ({
  enabled: false,
  webviews: [] as Array<{
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
  }>,
  unlistens: [] as Array<ReturnType<typeof vi.fn>>,
  resolveUnlistens: [] as Array<() => void>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.enabled,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: class {
    show = vi.fn(async () => {});
    hide = vi.fn(async () => {});
    close = vi.fn(async () => {});
    setPosition = vi.fn(async () => {});
    setSize = vi.fn(async () => {});

    constructor() {
      tauri.webviews.push(this);
    }

    once(event: string, callback: (event: { payload: unknown }) => void) {
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
  beforeEach(() => {
    tauri.enabled = false;
    tauri.webviews.length = 0;
    tauri.unlistens.length = 0;
    tauri.resolveUnlistens.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("shows the placeholder until an address is opened", () => {
    render(<BrowserPane />);
    expect(screen.getByLabelText("Browser address")).toBeInTheDocument();
    expect(screen.queryByTitle("Dock browser")).not.toBeInTheDocument();
  });

  it("normalizes and opens plain addresses as https", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "arxiv.org/abs/2401.00001" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const frame = screen.getByTitle("Dock browser") as HTMLIFrameElement;
    expect(frame.src).toBe("https://arxiv.org/abs/2401.00001");
  });

  it("rejects non-http schemes", () => {
    render(<BrowserPane />);
    const input = screen.getByLabelText("Browser address");
    fireEvent.change(input, { target: { value: "file:///etc/passwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByTitle("Dock browser")).not.toBeInTheDocument();
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
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(1));

    view.rerender(<BrowserPane visible={false} />);
    await vi.waitFor(() => expect(pane.hide).toHaveBeenCalledTimes(1));
    expect(pane.close).not.toHaveBeenCalled();

    view.rerender(<BrowserPane visible />);
    await vi.waitFor(() => expect(pane.show).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tauri.unlistens).toHaveLength(4));
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
});
