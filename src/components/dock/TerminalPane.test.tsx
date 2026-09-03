// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as Array<{
    onmessage:
      | ((message: { event: "output"; data: string } | { event: "exit" }) => void)
      | null;
  }>,
  resizeObservers: [] as Array<{
    callback: ResizeObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }>,
  terminals: [] as Array<{
    cols: number;
    rows: number;
    options: Record<string, unknown>;
    focus: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    dataHandler: ((data: string) => void) | null;
  }>,
  terminalColorThemes: {
    dark: {
      colors: {
        background: "#1e1e1e",
        foreground: "#f2f2f2",
        cursor: "#ffffff",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f78",
        selectionForeground: "#ffffff",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
    },
    light: {
      colors: {
        background: "#ffffff",
        foreground: "#1f2328",
        cursor: "#1f2328",
        cursorAccent: "#ffffff",
        selectionBackground: "#add6ff",
        selectionForeground: "#1f2328",
        black: "#000000",
        red: "#cd3131",
        green: "#00bc00",
        yellow: "#949800",
        blue: "#0451a5",
        magenta: "#bc05bc",
        cyan: "#0598bc",
        white: "#555555",
        brightBlack: "#666666",
        brightRed: "#cd3131",
        brightGreen: "#14ce14",
        brightYellow: "#b5ba00",
        brightBlue: "#0451a5",
        brightMagenta: "#bc05bc",
        brightCyan: "#0598bc",
        brightWhite: "#a5a5a5",
      },
    },
  },
  settings: {
    terminalOpen: true,
    setTerminalOpen: vi.fn(),
    terminalFontSize: 14,
    terminalFontFamily:
      'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
    terminalFontWeight: 500,
    terminalFontWeightBold: 700,
    terminalCursorStyle: "block",
    terminalCursorBlink: true,
    terminalStartWithProject: true,
    terminalColorTheme: "dark",
    terminalBackground: "#1e1e1e",
    terminalForeground: "#f2f2f2",
    terminalCursorColor: "#ffffff",
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage:
      | ((message: { event: "output"; data: string } | { event: "exit" }) => void)
      | null = null;

    constructor() {
      mocks.channels.push(this);
    }
  },
  invoke: mocks.invoke,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    focus = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
    dataHandler: ((data: string) => void) | null = null;
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.terminals.push(this);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => undefined);

    constructor() {
      mocks.fitAddons.push(this);
    }
  },
}));

vi.mock("@/store/settings", () => ({
  TERMINAL_COLOR_THEMES: mocks.terminalColorThemes,
  useSettingsStore: (selector: (settings: typeof mocks.settings) => unknown) =>
    selector(mocks.settings),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("TerminalPane", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "term_open" ? "term-1" : undefined),
    );
    mocks.channels.length = 0;
    mocks.terminals.length = 0;
    mocks.resizeObservers.length = 0;
    mocks.fitAddons.length = 0;
    mocks.settings.setTerminalOpen.mockReset();
    Object.assign(mocks.settings, {
      terminalOpen: true,
      terminalFontSize: 14,
      terminalFontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      terminalFontWeight: 500,
      terminalFontWeightBold: 700,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalStartWithProject: true,
      terminalColorTheme: "dark",
      terminalBackground: "#1e1e1e",
      terminalForeground: "#f2f2f2",
      terminalCursorColor: "#ffffff",
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: ResizeObserverCallback;
        disconnect = vi.fn();

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          mocks.resizeObservers.push(this);
        }

        observe() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("keeps the PTY alive across title and visibility changes", async () => {
    const { rerender, unmount } = render(<TerminalPane projectId="project-1" visible />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });

    rerender(<TerminalPane projectId="project-1" projectName="Paper" visible={false} />);
    rerender(<TerminalPane projectId="project-1" projectName="Paper" visible />);

    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_kill")).toHaveLength(0);

    unmount();

    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_kill")).toHaveLength(
        1,
      );
      expect(mocks.invoke).toHaveBeenCalledWith("term_kill", {
        id: "term-1",
        projectId: "project-1",
      });
    });
  });

  it("focuses xterm after opening, connecting, becoming visible, and being clicked", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];

    expect(terminal.focus).toHaveBeenCalled();
    terminal.focus.mockClear();
    open.resolve("term-1");
    await waitFor(() => expect(terminal.focus).toHaveBeenCalled());

    terminal.focus.mockClear();
    view.rerender(<TerminalPane projectId="project-1" visible={false} />);
    view.rerender(<TerminalPane projectId="project-1" visible />);
    expect(terminal.focus).toHaveBeenCalled();

    terminal.focus.mockClear();
    fireEvent.mouseDown(screen.getByTestId("dock-terminal"));
    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it("resizes the pty to the fitted size when the dock is shown before term_open resolves", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_resize")).toHaveLength(0);

    view.rerender(<TerminalPane projectId="project-1" visible />);
    open.resolve("term-1");

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_resize", {
        id: "term-1",
        projectId: "project-1",
        cols: mocks.terminals[0].cols,
        rows: mocks.terminals[0].rows,
      });
    });
  });

  it("forwards typed xterm data to the owning project terminal", async () => {
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(terminal.dataHandler).not.toBeNull());
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });

    terminal.dataHandler?.("printf ready\r");

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_write", {
        id: "term-1",
        projectId: "project-1",
        data: "printf ready\r",
      });
    });
  });

  it("queues xterm data sent before term_open resolves and flushes it in order", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(terminal.dataHandler).not.toBeNull());
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything());
    });

    terminal.dataHandler?.("\x1b[?1;2c");
    terminal.dataHandler?.("echo first\r");
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_write", expect.anything());

    open.resolve("term-1");

    await waitFor(() => {
      const writes = mocks.invoke.mock.calls
        .filter(([command]) => command === "term_write")
        .map(([, payload]) => (payload as { data: string }).data);
      expect(writes).toEqual(["\x1b[?1;2c", "echo first\r"]);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("term_write", {
      id: "term-1",
      projectId: "project-1",
      data: "\x1b[?1;2c",
    });
  });

  it("drops queued input when the pane is torn down before term_open resolves", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const { unmount } = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(terminal.dataHandler).not.toBeNull());

    terminal.dataHandler?.("\x1b[?1;2c");
    unmount();
    open.resolve("term-1");

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_kill", {
        id: "term-1",
        projectId: "project-1",
      });
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_write", expect.anything());
  });

  it("closes and disposes an exited session without accepting later input or resize", async () => {
    const onExit = vi.fn();
    render(<TerminalPane projectId="project-1" visible onExit={onExit} />);
    const terminal = mocks.terminals[0];
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    });
    const observer = mocks.resizeObservers[0];

    mocks.channels[0].onmessage?.({ event: "output", data: "ready\r\n" });
    expect(terminal.write).toHaveBeenCalledWith("ready\r\n", expect.any(Function));
    mocks.channels[0].onmessage?.({ event: "exit" });

    await waitFor(() => {
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(terminal.dispose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.settings.setTerminalOpen).not.toHaveBeenCalled();
    mocks.invoke.mockClear();

    terminal.dataHandler?.("after exit");
    observer.callback([], observer as unknown as ResizeObserver);

    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_write", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_resize", expect.anything());
  });

  it("stays stopped after exit instead of restarting when shown again", async () => {
    let opens = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") {
        opens += 1;
        return Promise.resolve(`term-${opens}`);
      }
      return Promise.resolve(undefined);
    });
    const onExit = vi.fn();
    const view = render(<TerminalPane projectId="project-1" visible onExit={onExit} />);
    await waitFor(() => expect(opens).toBe(1));

    mocks.channels[0].onmessage?.({ event: "exit" });
    await waitFor(() => expect(mocks.terminals[0].dispose).toHaveBeenCalledTimes(1));
    expect(onExit).toHaveBeenCalledTimes(1);
    view.rerender(<TerminalPane projectId="project-1" visible={false} onExit={onExit} />);
    view.rerender(<TerminalPane projectId="project-1" visible onExit={onExit} />);
    await Promise.resolve();

    expect(opens).toBe(1);
    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_kill", expect.anything());
  });

  it("shows a Loader2 spinner until the terminal session is ready", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible />);

    const loading = screen.getByTestId("dock-terminal-loading");
    expect(loading.querySelector("svg.animate-spin")).not.toBeNull();

    open.resolve("term-1");
    await waitFor(() => expect(screen.queryByTestId("dock-terminal-loading")).toBeNull());
  });

  it("reveals terminal open errors instead of leaving the loading layer in place", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open"
        ? Promise.reject(new Error("pty unavailable"))
        : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];

    await waitFor(() => {
      expect(terminal.writeln).toHaveBeenCalledWith(
        "\r\nThe shell could not start: Error: pty unavailable",
        expect.any(Function),
      );
    });
    expect(screen.queryByTestId("dock-terminal-loading")).toBeNull();
  });

  it("writes input and resize failures into the terminal", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") return Promise.resolve("term-1");
      if (command === "term_write") return Promise.reject(new Error("write denied"));
      if (command === "term_resize") return Promise.reject(new Error("resize denied"));
      return Promise.resolve(undefined);
    });
    const view = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(terminal.dataHandler).not.toBeNull());
    await waitFor(() => {
      terminal.dataHandler?.("pwd\r");
      expect(mocks.invoke.mock.calls.some(([command]) => command === "term_write")).toBe(true);
    });

    view.rerender(<TerminalPane projectId="project-1" visible={false} />);
    view.rerender(<TerminalPane projectId="project-1" visible />);

    await waitFor(() => {
      expect(terminal.writeln).toHaveBeenCalledWith(
        "\r\nThe shell could not accept input: Error: write denied",
        expect.any(Function),
      );
      expect(terminal.writeln).toHaveBeenCalledWith(
        "\r\nThe terminal could not resize: Error: resize denied",
        expect.any(Function),
      );
    });
  });

  it("surfaces the same input failure only once per session", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") return Promise.resolve("term-1");
      if (command === "term_write") return Promise.reject(new Error("write denied"));
      return Promise.resolve(undefined);
    });
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    });

    terminal.dataHandler?.("first");
    terminal.dataHandler?.("second");

    await waitFor(() => {
      expect(terminal.writeln).toHaveBeenCalledTimes(1);
      expect(terminal.writeln).toHaveBeenCalledWith(
        "\r\nThe shell could not accept input: Error: write denied",
        expect.any(Function),
      );
    });
  });

  it("suppresses a pending input failure after the session exits", async () => {
    const write = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") return Promise.resolve("term-1");
      if (command === "term_write") return write.promise;
      return Promise.resolve(undefined);
    });
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    });

    terminal.dataHandler?.("exit\r");
    mocks.channels[0].onmessage?.({ event: "exit" });
    write.reject(new Error("terminal session is not open"));

    await waitFor(() => expect(terminal.dispose).toHaveBeenCalledTimes(1));
    expect(terminal.writeln).not.toHaveBeenCalled();
  });

  it("uses terminal appearance settings and a complete dark ANSI palette", () => {
    Object.assign(mocks.settings, {
      terminalFontSize: 17,
      terminalFontFamily: "JetBrains Mono",
      terminalFontWeight: 600,
      terminalFontWeightBold: 800,
      terminalCursorStyle: "bar",
      terminalCursorBlink: false,
      terminalBackground: "#101112",
      terminalForeground: "#f8f9fa",
      terminalCursorColor: "#abcdef",
    });
    render(<TerminalPane projectId="project-1" visible />);

    expect(mocks.terminals[0].options).toMatchObject({
      fontSize: 17,
      fontFamily: "JetBrains Mono",
      fontWeight: 600,
      fontWeightBold: 800,
      cursorStyle: "bar",
      cursorBlink: false,
      drawBoldTextInBrightColors: true,
      theme: {
        background: "#101112",
        foreground: "#f8f9fa",
        cursor: "#abcdef",
        black: expect.any(String),
        red: expect.any(String),
        green: expect.any(String),
        yellow: expect.any(String),
        blue: expect.any(String),
        magenta: expect.any(String),
        cyan: expect.any(String),
        white: expect.any(String),
        brightBlack: expect.any(String),
        brightRed: expect.any(String),
        brightGreen: expect.any(String),
        brightYellow: expect.any(String),
        brightBlue: expect.any(String),
        brightMagenta: expect.any(String),
        brightCyan: expect.any(String),
        brightWhite: expect.any(String),
      },
    });
    expect(screen.getByTestId("dock-terminal")).toHaveStyle({ backgroundColor: "#101112" });
  });

  it("applies terminal appearance changes to the open xterm instance", async () => {
    const view = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    });

    Object.assign(mocks.settings, {
      terminalFontSize: 18,
      terminalFontFamily: "Iosevka",
      terminalFontWeight: 550,
      terminalFontWeightBold: 750,
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalColorTheme: "light",
      terminalBackground: "#fafafa",
      terminalForeground: "#202124",
      terminalCursorColor: "#123456",
    });
    view.rerender(<TerminalPane projectId="project-1" visible />);

    expect(terminal.options).toMatchObject({
      fontSize: 18,
      fontFamily: "Iosevka",
      fontWeight: 550,
      fontWeightBold: 750,
      cursorStyle: "underline",
      cursorBlink: false,
      theme: {
        background: "#fafafa",
        foreground: "#202124",
        cursor: "#123456",
        black: expect.any(String),
        brightWhite: expect.any(String),
      },
    });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
  });

  it("starts the project shell while the dock is hidden without focusing or fitting it", async () => {
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    const terminal = mocks.terminals[0];
    const fit = mocks.fitAddons[0];
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1", cols: 80, rows: 24 }),
      );
    });
    await waitFor(() => expect(screen.queryByTestId("dock-terminal-loading")).toBeNull());
    expect(terminal.focus).not.toHaveBeenCalled();
    expect(fit.fit).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_resize", expect.anything());

    mocks.channels[0].onmessage?.({ event: "output", data: "prompt$ " });
    expect(terminal.write).toHaveBeenCalledWith("prompt$ ", expect.any(Function));

    view.rerender(<TerminalPane projectId="project-1" visible />);

    expect(fit.fit).toHaveBeenCalledTimes(1);
    expect(terminal.focus).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_resize", {
        id: "term-1",
        projectId: "project-1",
        cols: 80,
        rows: 24,
      });
    });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    expect(screen.queryByTestId("dock-terminal-loading")).toBeNull();
  });

  it("waits for the first show when starting with the project is turned off", async () => {
    mocks.settings.terminalStartWithProject = false;
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await Promise.resolve();

    expect(mocks.terminals).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_open", expect.anything());

    view.rerender(<TerminalPane projectId="project-1" visible />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });
    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.terminals[0].focus).toHaveBeenCalled();
  });

  it("reports a hidden shell that exited without reopening the dock", async () => {
    let opens = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") {
        opens += 1;
        return Promise.resolve(`term-${opens}`);
      }
      return Promise.resolve(undefined);
    });
    const onExit = vi.fn();
    const view = render(<TerminalPane projectId="project-1" visible={false} onExit={onExit} />);
    await waitFor(() => expect(opens).toBe(1));

    mocks.channels[0].onmessage?.({ event: "exit" });
    await waitFor(() => expect(mocks.terminals[0].dispose).toHaveBeenCalledTimes(1));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(mocks.settings.setTerminalOpen).not.toHaveBeenCalled();
    view.rerender(<TerminalPane projectId="project-1" visible={false} onExit={onExit} />);
    await Promise.resolve();
    expect(opens).toBe(1);
  });

  it("starts a hidden terminal right away when autoStart is set", async () => {
    mocks.settings.terminalStartWithProject = false;
    render(<TerminalPane projectId="project-1" visible={false} autoStart />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });
    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.terminals[0].focus).not.toHaveBeenCalled();
  });

  it("keeps the dock test ids for the active pane only", async () => {
    const open = deferred<string>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible={false} active={false} />);

    expect(screen.queryByTestId("dock-terminal")).toBeNull();
    expect(screen.queryByTestId("dock-terminal-host")).toBeNull();
    expect(screen.queryByTestId("dock-terminal-loading")).toBeNull();
    expect(screen.getByTestId("dock-terminal-inactive")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("dock-terminal-inactive").className).toContain("h-0");

    view.rerender(<TerminalPane projectId="project-1" visible active />);

    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("dock-terminal-host")).toBeInTheDocument();
    expect(screen.getByTestId("dock-terminal-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-terminal-inactive")).toBeNull();
  });

  it("replaces the hidden shell when the project changes", async () => {
    let opens = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "term_open") {
        opens += 1;
        return Promise.resolve(`term-${opens}`);
      }
      return Promise.resolve(undefined);
    });
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(opens).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("dock-terminal-loading")).toBeNull());

    view.rerender(<TerminalPane projectId="project-2" visible={false} />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_kill", {
        id: "term-1",
        projectId: "project-1",
      });
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-2" }),
      );
    });
    expect(mocks.terminals[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.terminals[1].focus).not.toHaveBeenCalled();
  });

  it("does not fit or resize a hidden terminal when its appearance changes", async () => {
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(screen.queryByTestId("dock-terminal-loading")).toBeNull());
    const terminal = mocks.terminals[0];
    const fit = mocks.fitAddons[0];

    mocks.settings.terminalFontSize = 18;
    view.rerender(<TerminalPane projectId="project-1" visible={false} />);

    expect(terminal.options.fontSize).toBe(18);
    expect(fit.fit).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_resize", expect.anything());
  });
});
