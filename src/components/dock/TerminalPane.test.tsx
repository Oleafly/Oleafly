// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { terminalSessionFor } from "@/lib/terminal-sessions";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import { LAUNCH_INPUT_FALLBACK_MS, TerminalPane, TITLE_THROTTLE_MS } from "./TerminalPane";

type TerminalMessage =
  | { event: "output"; data: string; bytes: number }
  | { event: "exit" }
  | { event: "input_error"; message: string };

interface FakeTerminal {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  focus: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  writeln: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  hasSelection: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  dataHandler: ((data: string) => void) | null;
  scrollHandler: (() => void) | null;
  bellHandler: (() => void) | null;
  titleHandler: ((title: string) => void) | null;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  oscHandlers: Map<number, (data: string) => boolean>;
  registerLinkProvider: ReturnType<typeof vi.fn>;
  linkProviderDisposers: Array<ReturnType<typeof vi.fn>>;
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as Array<{ onmessage: ((message: TerminalMessage) => void) | null }>,
  resizeObservers: [] as Array<{
    callback: ResizeObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }>,
  terminals: [] as FakeTerminal[],
  searchAddons: [] as Array<{ options: unknown; findNext: ReturnType<typeof vi.fn> }>,
  clipboard: vi.fn(async (_text: string) => {}),
  platform: "linux" as "mac" | "windows" | "linux",
  windowsPty: undefined as undefined | { backend: "conpty"; buildNumber?: number },
  windowsPtyOption: vi.fn(),
  linkTooltip: null as null | {
    hover: (info: { label: string; kind: "file" | "url" }, event: MouseEvent) => void;
    leave: () => void;
  },
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
    terminalShell: "auto",
    terminalShellPath: "",
    terminalShiftEnter: "newline",
    terminalCopyOnSelect: false,
    terminalOptionIsMeta: false,
    terminalScrollback: 5000,
    terminalConfirmClose: true,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((message: TerminalMessage) => void) | null = null;

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
    unicode = { activeVersion: "6" };
    element = document.createElement("div");
    focus = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn((_data: string, done?: () => void) => done?.());
    writeln = vi.fn();
    dispose = vi.fn();
    paste = vi.fn();
    clear = vi.fn();
    selectAll = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    clearSelection = vi.fn();
    dataHandler: ((data: string) => void) | null = null;
    scrollHandler: (() => void) | null = null;
    bellHandler: (() => void) | null = null;
    titleHandler: ((title: string) => void) | null = null;
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    oscHandlers = new Map<number, (data: string) => boolean>();
    buffer = { active: { getLine: () => undefined } };
    linkProviderDisposers: Array<ReturnType<typeof vi.fn>> = [];
    input = vi.fn((data: string, _wasUserInput?: boolean) => this.dataHandler?.(data));
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    });
    onScroll = vi.fn((handler: () => void) => {
      this.scrollHandler = handler;
      return { dispose: vi.fn() };
    });
    onBell = vi.fn((handler: () => void) => {
      this.bellHandler = handler;
      return { dispose: vi.fn() };
    });
    onTitleChange = vi.fn((handler: (title: string) => void) => {
      this.titleHandler = handler;
      return { dispose: vi.fn() };
    });
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = handler;
    });
    parser = {
      registerOscHandler: vi.fn((ident: number, handler: (data: string) => boolean) => {
        this.oscHandlers.set(ident, handler);
        return { dispose: vi.fn() };
      }),
    };
    registerLinkProvider = vi.fn(() => {
      const dispose = vi.fn();
      this.linkProviderDisposers.push(dispose);
      return { dispose };
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.terminals.push(this as unknown as FakeTerminal);
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

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class {},
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    options: unknown;
    findNext = vi.fn(() => true);
    findPrevious = vi.fn(() => true);
    clearDecorations = vi.fn();
    onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }));

    constructor(options: unknown) {
      this.options = options;
      mocks.searchAddons.push(this);
    }
  },
}));

vi.mock("@/lib/terminal-platform", () => ({
  windowsPtyOption: (platform: string) => {
    mocks.windowsPtyOption(platform);
    return mocks.windowsPty;
  },
}));

vi.mock("@/lib/terminal-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/terminal-keys")>()),
  terminalPlatform: () => mocks.platform,
}));

vi.mock("./terminal-clipboard", () => ({ copyTerminalText: mocks.clipboard }));

// The real adapters reach the files store, which the partial settings mock
// below cannot satisfy. Keep the tooltip callbacks so tests can drive them.
vi.mock("./terminal-link-actions", () => ({
  createTerminalLinkActions: (
    _projectId: string,
    tooltip: NonNullable<typeof mocks.linkTooltip>,
  ) => {
    mocks.linkTooltip = tooltip;
    return { resolve: () => null, openFile: vi.fn(), openUrl: vi.fn(), ...tooltip };
  },
}));

vi.mock("@/store/settings", () => ({
  TERMINAL_COLOR_THEMES: mocks.terminalColorThemes,
  resolveTerminalTheme: (
    appearance: {
      terminalColorTheme: string;
      terminalBackground: string;
      terminalForeground: string;
      terminalCursorColor: string;
    },
    appTheme: "light" | "dark",
  ) => {
    const themes = mocks.terminalColorThemes as Record<string, { colors: Record<string, string> }>;
    const palette = themes[appearance.terminalColorTheme] ?? themes[appTheme];
    if (appearance.terminalColorTheme === "system") return { ...themes[appTheme].colors };
    return {
      ...palette.colors,
      background: appearance.terminalBackground,
      foreground: appearance.terminalForeground,
      cursor: appearance.terminalCursorColor,
    };
  },
  withTerminalGlyphFallbacks: (family: string) => `${family}, "Symbols Nerd Font Mono"`,
  useSettingsStore: Object.assign(
    (selector: (settings: typeof mocks.settings) => unknown) => selector(mocks.settings),
    { getState: () => mocks.settings },
  ),
}));

const OPENED = { id: "term-1", shell: "posix", shellId: "auto" };

function opened(id: string, shell = "posix", shellId = "auto") {
  return { id, shell, shellId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function writes(): string[] {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "term_write")
    .map(([, payload]) => (payload as { data: string }).data);
}

function output(data: string, bytes = new TextEncoder().encode(data).length) {
  mocks.channels[0].onmessage?.({ event: "output", data, bytes });
}

async function waitForSession() {
  await waitFor(() => expect(screen.queryByTestId("dock-terminal-loading")).toBeNull());
}

describe("TerminalPane", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "term_open" ? OPENED : undefined),
    );
    mocks.channels.length = 0;
    mocks.terminals.length = 0;
    mocks.resizeObservers.length = 0;
    mocks.fitAddons.length = 0;
    mocks.searchAddons.length = 0;
    mocks.clipboard.mockClear();
    mocks.platform = "linux";
    mocks.windowsPty = undefined;
    mocks.windowsPtyOption.mockClear();
    mocks.linkTooltip = null;
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
      terminalShell: "auto",
      terminalShellPath: "",
      terminalShiftEnter: "newline",
      terminalCopyOnSelect: false,
      terminalOptionIsMeta: false,
      terminalScrollback: 5000,
      terminalConfirmClose: true,
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the PTY alive across visibility changes", async () => {
    const { rerender, unmount } = render(<TerminalPane projectId="project-1" visible />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });

    rerender(<TerminalPane projectId="project-1" visible={false} />);
    rerender(<TerminalPane projectId="project-1" visible />);

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

  it("reports a started session once, and nothing when the shell cannot start", async () => {
    const onStarted = vi.fn();
    const view = render(<TerminalPane projectId="project-1" visible onStarted={onStarted} />);
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    view.unmount();

    const failed = vi.fn();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? Promise.reject(new Error("no shell")) : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible onStarted={failed} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()),
    );
    await act(async () => {});
    expect(failed).not.toHaveBeenCalled();
  });

  it("focuses xterm after opening, connecting, becoming visible, and being clicked", async () => {
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];

    expect(terminal.focus).toHaveBeenCalled();
    terminal.focus.mockClear();
    open.resolve(OPENED);
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
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_resize")).toHaveLength(0);

    view.rerender(<TerminalPane projectId="project-1" visible />);
    open.resolve(OPENED);

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
    await waitForSession();

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
    const open = deferred<typeof OPENED>();
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

    open.resolve(OPENED);

    await waitFor(() => expect(writes()).toEqual(["\x1b[?1;2c", "echo first\r"]));
    expect(mocks.invoke).toHaveBeenCalledWith("term_write", {
      id: "term-1",
      projectId: "project-1",
      data: "\x1b[?1;2c",
    });
  });

  it("drops queued input when the pane is torn down before term_open resolves", async () => {
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const { unmount } = render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()));

    terminal.dataHandler?.("\x1b[?1;2c");
    unmount();
    open.resolve(OPENED);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_kill", {
        id: "term-1",
        projectId: "project-1",
      });
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_write", expect.anything());
  });

  it("types initialInput after queued terminal replies and the first output", async () => {
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible initialInput={"'/usr/local/bin/pi'\r"} />);
    const terminal = mocks.terminals[0];
    await waitFor(() => expect(terminal.dataHandler).not.toBeNull());
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything());
    });
    terminal.dataHandler?.("\x1b[?1;2c");
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_write", expect.anything());

    open.resolve(OPENED);
    await waitFor(() => expect(writes()).toEqual(["\x1b[?1;2c"]));

    act(() => output("prompt$ "));
    await waitFor(() => expect(writes()).toEqual(["\x1b[?1;2c", "'/usr/local/bin/pi'\r"]));
    act(() => output("more"));
    view.rerender(<TerminalPane projectId="project-1" visible={false} initialInput={"'/usr/local/bin/pi'\r"} />);
    view.rerender(<TerminalPane projectId="project-1" visible initialInput={"'/usr/local/bin/pi'\r"} />);
    expect(writes()).toHaveLength(2);
  });

  it("types the launch command once, after the first output is parsed, quoted for the shell", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "term_open" ? opened("term-1", "powershell", "pwsh") : undefined),
    );
    render(
      <TerminalPane
        projectId="project-1"
        visible
        launch={{ command: "C:\\Program Files\\Claude\\claude.exe", args: ["login"] }}
      />,
    );
    await waitFor(() => expect(mocks.channels).toHaveLength(1));
    const terminal = mocks.terminals[0];
    terminal.write.mockImplementation((data: string, done?: () => void) => {
      // Like xterm: the DA1 reply comes out while parsing, before the callback.
      if (data === "\x1b[c") terminal.dataHandler?.("\x1b[?1;2c");
      done?.();
    });
    expect(writes()).toEqual([]);

    await waitForSession();
    act(() => output("\x1b[c", 3));

    await waitFor(() =>
      expect(writes()).toEqual(["\x1b[?1;2c", "& 'C:\\Program Files\\Claude\\claude.exe' login\r"]),
    );
    act(() => output("PS> "));
    expect(writes()).toHaveLength(2);
  });

  it("types the launch command after a quiet start once the fallback fires", async () => {
    vi.useFakeTimers();
    render(<TerminalPane projectId="project-1" visible launch={{ command: "/usr/bin/pi", args: ["login"] }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(writes()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_INPUT_FALLBACK_MS - 1);
    });
    expect(writes()).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(writes()).toEqual(["/usr/bin/pi login\r"]);
  });

  it("opens the shell with the tab's folder, env and the shell setting", async () => {
    Object.assign(mocks.settings, { terminalShell: "gitBash", terminalShellPath: "" });
    render(<TerminalPane projectId="project-1" visible cwd="chapters" env={{ FOO: "1" }} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({
          options: { cwd: "chapters", env: { FOO: "1" }, shell: { id: "gitBash", path: "" } },
        }),
      ),
    );
  });

  it("starts a launched command in the default shell when the setting is WSL", async () => {
    Object.assign(mocks.settings, { terminalShell: "wsl", terminalShellPath: "" });
    render(<TerminalPane projectId="project-1" visible launch={{ command: "pi", args: [] }} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ options: expect.objectContaining({ shell: { id: "auto" } }) }),
      ),
    );
  });

  it("keeps WSL for a plain terminal", async () => {
    Object.assign(mocks.settings, { terminalShell: "wsl", terminalShellPath: "" });
    render(<TerminalPane projectId="project-1" visible />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ options: expect.objectContaining({ shell: { id: "wsl", path: "" } }) }),
      ),
    );
  });

  it("writes output to a hidden terminal right away and never opens it while hidden", async () => {
    render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()));
    act(() => output("prompt$ ", 8));
    expect(mocks.terminals[0].write).toHaveBeenCalledWith("prompt$ ", expect.any(Function));
    expect(mocks.terminals[0].open).not.toHaveBeenCalled();
  });

  it("parks an opened pane at its last size instead of collapsing it", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 300,
      top: 0,
      left: 0,
      right: 800,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      const view = render(<TerminalPane projectId="project-1" visible active />);
      view.rerender(<TerminalPane projectId="project-1" visible={false} active />);
      const pane = screen.getByTestId("dock-terminal");
      expect(pane.className).toContain("invisible");
      expect(pane.className).toContain("absolute");
      expect(pane.className).not.toContain("h-0");
      expect(pane.style.width).toBe("800px");
      expect(pane.style.height).toBe("300px");
      expect(pane).toHaveAttribute("inert");
      expect(pane).toHaveAttribute("aria-hidden", "true");

      view.rerender(<TerminalPane projectId="project-1" visible active />);
      expect(pane.className).not.toContain("invisible");
      expect(pane).not.toHaveAttribute("inert");
      expect(pane.style.width).toBe("");
    } finally {
      rect.mockRestore();
    }
  });

  it("keeps writing to a parked pane and opens xterm only once", async () => {
    const view = render(<TerminalPane projectId="project-1" visible />);
    await waitForSession();
    view.rerender(<TerminalPane projectId="project-1" visible={false} />);

    act(() => output("while parked"));
    expect(mocks.terminals[0].write).toHaveBeenCalledWith("while parked", expect.any(Function));
    view.rerender(<TerminalPane projectId="project-1" visible />);
    act(() => output("shown again"));

    expect(mocks.terminals[0].write).toHaveBeenCalledTimes(2);
    expect(mocks.terminals[0].open).toHaveBeenCalledTimes(1);
  });

  it("acknowledges output only after xterm parsed it", async () => {
    render(<TerminalPane projectId="project-1" visible />);
    await waitForSession();
    const terminal = mocks.terminals[0];
    const held: Array<() => void> = [];
    terminal.write.mockImplementation((_data: string, done?: () => void) => {
      if (done) held.push(done);
    });
    const chunk = "x".repeat(65536);

    act(() => {
      for (let count = 0; count < 3; count += 1) output(chunk, 65536);
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_ack", expect.anything());

    act(() => {
      for (const done of held.splice(0)) done();
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("term_ack", { id: "term-1", projectId: "project-1", bytes: 131072 }),
    );
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_ack")).toHaveLength(1);
  });

  it("holds acknowledgements for output that arrived before the session id", async () => {
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible />);
    await waitFor(() => expect(mocks.channels).toHaveLength(1));

    act(() => {
      output("y".repeat(98304), 98304);
      output("y".repeat(98304), 98304);
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("term_ack", expect.anything());

    await act(async () => {
      open.resolve(OPENED);
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("term_ack", { id: "term-1", projectId: "project-1", bytes: 196608 }),
    );
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_ack")).toHaveLength(1);
  });

  it("passes windowsPty only on Windows and applies scrollback and Option as Meta", () => {
    mocks.platform = "windows";
    mocks.windowsPty = { backend: "conpty", buildNumber: 22631 };
    Object.assign(mocks.settings, { terminalScrollback: 25000, terminalOptionIsMeta: true });
    const windows = render(<TerminalPane projectId="project-1" visible />);
    expect(mocks.windowsPtyOption).toHaveBeenCalledWith("windows");
    expect(mocks.terminals[0].options).toMatchObject({
      windowsPty: { backend: "conpty", buildNumber: 22631 },
      scrollback: 25000,
      macOptionIsMeta: false,
    });
    windows.unmount();

    mocks.platform = "mac";
    mocks.windowsPty = undefined;
    const mac = render(<TerminalPane projectId="project-1" visible />);
    expect(mocks.terminals[1].options.windowsPty).toBeUndefined();
    expect(mocks.terminals[1].options.macOptionIsMeta).toBe(true);

    Object.assign(mocks.settings, { terminalScrollback: 1000, terminalOptionIsMeta: false });
    mac.rerender(<TerminalPane projectId="project-1" visible />);
    expect(mocks.terminals[1].options).toMatchObject({ scrollback: 1000, macOptionIsMeta: false });
    expect(mocks.terminals).toHaveLength(2);
  });

  it("registers the tab's session and forgets it on dispose", async () => {
    const view = render(<TerminalPane projectId="project-1" tabId="terminal-1" visible />);
    await waitFor(() =>
      expect(terminalSessionFor("terminal-1")).toEqual({ projectId: "project-1", sessionId: "term-1" }),
    );
    view.unmount();
    expect(terminalSessionFor("terminal-1")).toBeUndefined();
  });

  it("does not write a title into the terminal", async () => {
    render(<TerminalPane projectId="project-1" visible />);
    await waitForSession();
    const titles = mocks.terminals[0].write.mock.calls.filter(([data]) => String(data).startsWith("\x1b]2;"));
    expect(titles).toEqual([]);
  });

  it("closes and disposes an exited session without accepting later input or resize", async () => {
    const onExit = vi.fn();
    render(<TerminalPane projectId="project-1" visible onExit={onExit} />);
    const terminal = mocks.terminals[0];
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    });
    const observer = mocks.resizeObservers[0];

    output("ready\r\n");
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
        return Promise.resolve(opened(`term-${opens}`));
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
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    render(<TerminalPane projectId="project-1" visible />);

    const loading = screen.getByTestId("dock-terminal-loading");
    expect(loading.querySelector("svg.animate-spin")).not.toBeNull();

    open.resolve(OPENED);
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
      if (command === "term_open") return Promise.resolve(OPENED);
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
      if (command === "term_open") return Promise.resolve(OPENED);
      if (command === "term_write") return Promise.reject(new Error("write denied"));
      return Promise.resolve(undefined);
    });
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitForSession();

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
      if (command === "term_open") return Promise.resolve(OPENED);
      if (command === "term_write") return write.promise;
      return Promise.resolve(undefined);
    });
    render(<TerminalPane projectId="project-1" visible />);
    const terminal = mocks.terminals[0];
    await waitForSession();

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
      fontFamily: 'JetBrains Mono, "Symbols Nerd Font Mono"',
      allowProposedApi: true,
      fontWeight: 600,
      fontWeightBold: 800,
      cursorStyle: "bar",
      cursorBlink: false,
      drawBoldTextInBrightColors: true,
      scrollback: 5000,
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
      fontFamily: 'Iosevka, "Symbols Nerd Font Mono"',
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

    output("prompt$ ");
    expect(terminal.write).toHaveBeenCalledWith("prompt$ ", expect.any(Function));
    expect(terminal.open).not.toHaveBeenCalled();

    view.rerender(<TerminalPane projectId="project-1" visible />);

    expect(terminal.open).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledTimes(1);
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
        return Promise.resolve(opened(`term-${opens}`));
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

  it("stays quiet and waits for the user when a restricted folder refuses a background start", async () => {
    let opens = 0;
    mocks.invoke.mockImplementation((command: string, args?: { autostart?: boolean }) => {
      if (command === "term_open") {
        opens += 1;
        return args?.autostart
          ? Promise.reject('@oleafly/error:{"code":"trust.terminal","params":{},"detail":null}')
          : Promise.resolve(opened(`term-${opens}`));
      }
      return Promise.resolve(undefined);
    });
    const view = render(<TerminalPane projectId="project-1" visible={false} />);
    await waitFor(() => expect(opens).toBe(1));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "term_open",
      expect.objectContaining({ autostart: true }),
    );
    await waitFor(() => expect(mocks.terminals[0].dispose).toHaveBeenCalled());
    expect(mocks.terminals[0].write).not.toHaveBeenCalled();
    expect(mocks.terminals[0].writeln).not.toHaveBeenCalled();
    view.rerender(<TerminalPane projectId="project-1" visible />);
    await waitFor(() => expect(opens).toBe(2));
    const openedCalls = mocks.invoke.mock.calls.filter(([command]) => command === "term_open");
    expect(openedCalls[1][1]).toEqual(expect.objectContaining({ autostart: false }));
  });

  it("tries a background start again for the next project after a refusal", async () => {
    let opens = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { autostart?: boolean; projectId?: string }) => {
        if (command === "term_open") {
          opens += 1;
          return args?.projectId === "restricted"
            ? Promise.reject('@oleafly/error:{"code":"trust.terminal","params":{},"detail":null}')
            : Promise.resolve(opened(`term-${opens}`));
        }
        return Promise.resolve(undefined);
      },
    );
    const view = render(<TerminalPane projectId="restricted" visible={false} />);
    await waitFor(() => expect(mocks.terminals[0]?.dispose).toHaveBeenCalled());
    view.rerender(<TerminalPane projectId="trusted" visible={false} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "trusted", autostart: true }),
      ),
    );
    expect(opens).toBe(2);
  });

  it("keeps the dock test ids for the active pane only", async () => {
    const open = deferred<typeof OPENED>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "term_open" ? open.promise : Promise.resolve(undefined),
    );
    const view = render(<TerminalPane projectId="project-1" visible={false} active={false} />);

    expect(screen.queryByTestId("dock-terminal")).toBeNull();
    expect(screen.queryByTestId("dock-terminal-host")).toBeNull();
    expect(screen.queryByTestId("dock-terminal-loading")).toBeNull();
    expect(screen.getByTestId("dock-terminal-inactive")).toHaveAttribute("aria-hidden", "true");
    // Never opened, so it collapses instead of parking.
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
        return Promise.resolve(opened(`term-${opens}`));
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

  describe("keys and extras", () => {
    it("routes Shift+Enter from the key handler to the shell", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      const terminal = mocks.terminals[0];
      const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });

      expect(terminal.keyHandler?.(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(terminal.input).toHaveBeenCalledWith("\n", true);
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith("term_write", { id: "term-1", projectId: "project-1", data: "\n" }),
      );
    });

    it("sends ESC CR for Shift+Enter on Windows and LF under WSL", async () => {
      mocks.platform = "windows";
      const shiftEnter = () =>
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });
      mocks.invoke.mockImplementation((command: string) =>
        Promise.resolve(command === "term_open" ? opened("term-1", "powershell", "pwsh") : undefined),
      );
      const pwsh = render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      mocks.terminals[0].keyHandler?.(shiftEnter());
      expect(mocks.terminals[0].input).toHaveBeenLastCalledWith("\x1b\r", true);
      pwsh.unmount();

      mocks.invoke.mockImplementation((command: string) =>
        Promise.resolve(command === "term_open" ? opened("term-2", "posix", "wsl") : undefined),
      );
      render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      mocks.terminals[1].keyHandler?.(shiftEnter());
      expect(mocks.terminals[1].input).toHaveBeenLastCalledWith("\n", true);
    });

    it("opens the find bar on Ctrl+F, loading the search addon once", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      const terminal = mocks.terminals[0];
      const ctrlF = () => new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });

      act(() => {
        terminal.keyHandler?.(ctrlF());
      });
      const label = enWorkspace.terminal.find.label;
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
      expect(mocks.searchAddons).toHaveLength(1);
      expect(mocks.searchAddons[0].options).toEqual({ highlightLimit: 1000 });
      expect(terminal.loadAddon).toHaveBeenCalledWith(mocks.searchAddons[0]);

      fireEvent.change(screen.getByLabelText(label), { target: { value: "error" } });
      expect(mocks.searchAddons[0].findNext).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ incremental: true, decorations: expect.any(Object) }),
      );

      fireEvent.keyDown(screen.getByLabelText(label), { key: "Escape" });
      await waitFor(() => expect(screen.queryByLabelText(label)).toBeNull());
      expect(terminal.focus).toHaveBeenCalled();

      act(() => {
        terminal.keyHandler?.(ctrlF());
      });
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
      expect(mocks.searchAddons).toHaveLength(1);
    });

    it("keeps the click-to-focus behaviour off the find bar", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      const terminal = mocks.terminals[0];
      act(() => {
        terminal.keyHandler?.(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
      });
      const input = await screen.findByLabelText(enWorkspace.terminal.find.label);

      terminal.focus.mockClear();
      fireEvent.mouseDown(input);
      expect(terminal.focus).not.toHaveBeenCalled();
      fireEvent.mouseDown(screen.getByTestId("dock-terminal-host"));
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    });

    it("copies a mouse selection on mouseup when copy on select is on", () => {
      mocks.settings.terminalCopyOnSelect = true;
      render(<TerminalPane projectId="project-1" visible />);
      const terminal = mocks.terminals[0];
      terminal.hasSelection.mockReturnValue(true);
      terminal.getSelection.mockReturnValue("ls -la");
      const host = screen.getByTestId("dock-terminal-host");

      fireEvent.mouseUp(host);
      expect(mocks.clipboard).toHaveBeenCalledWith("ls -la");

      mocks.settings.terminalCopyOnSelect = false;
      fireEvent.mouseUp(host);
      expect(mocks.clipboard).toHaveBeenCalledTimes(1);
    });

    it("writes OSC 52 text to the clipboard only while visible and never answers a query", async () => {
      const view = render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      const terminal = mocks.terminals[0];
      const handler = terminal.oscHandlers.get(52);

      expect(handler?.("c;aGVsbG8=")).toBe(true);
      expect(mocks.clipboard).toHaveBeenCalledWith("hello");
      expect(handler?.("c;?")).toBe(true);
      expect(terminal.input).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);

      view.rerender(<TerminalPane projectId="project-1" visible={false} />);
      expect(handler?.("c;d29ybGQ=")).toBe(true);
      expect(mocks.clipboard).toHaveBeenCalledTimes(1);
    });

    it("reports a bell only while hidden", () => {
      const onBell = vi.fn();
      const view = render(<TerminalPane projectId="project-1" visible onBell={onBell} />);
      act(() => mocks.terminals[0].bellHandler?.());
      expect(onBell).not.toHaveBeenCalled();

      view.rerender(<TerminalPane projectId="project-1" visible={false} onBell={onBell} />);
      act(() => mocks.terminals[0].bellHandler?.());
      expect(onBell).toHaveBeenCalledTimes(1);
    });

    it("reports title changes at most every 250 ms and clamps them to 200 characters", async () => {
      vi.useFakeTimers();
      const onTitle = vi.fn();
      render(<TerminalPane projectId="project-1" visible onTitle={onTitle} />);
      const terminal = mocks.terminals[0];

      act(() => terminal.titleHandler?.("first"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onTitle).toHaveBeenLastCalledWith("first");

      act(() => {
        terminal.titleHandler?.("second");
        terminal.titleHandler?.("x".repeat(300));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TITLE_THROTTLE_MS - 1);
      });
      expect(onTitle).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onTitle).toHaveBeenCalledTimes(2);
      expect(onTitle).toHaveBeenLastCalledWith("x".repeat(200));
    });

    it("pastes a quoted path when a file is dropped from the tree", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      await waitForSession();
      const pane = screen.getByTestId("dock-terminal");
      const dataTransfer = {
        types: [TREE_DRAG_TYPE],
        getData: (type: string) => (type === TREE_DRAG_TYPE ? "src/main.tex" : ""),
        dropEffect: "none",
      };

      fireEvent.dragOver(pane, { dataTransfer });
      fireEvent.drop(pane, { dataTransfer });

      expect(mocks.terminals[0].paste).toHaveBeenCalledWith("src/main.tex ");
    });
  });

  describe("links", () => {
    it("registers one link provider per terminal and disposes it before the terminal", async () => {
      const view = render(<TerminalPane projectId="project-1" visible />);
      const terminal = mocks.terminals[0];
      expect(terminal.registerLinkProvider).toHaveBeenCalledTimes(1);

      view.rerender(<TerminalPane projectId="project-1" visible={false} />);
      view.rerender(<TerminalPane projectId="project-1" visible />);
      expect(terminal.registerLinkProvider).toHaveBeenCalledTimes(1);

      view.unmount();
      const [dispose] = terminal.linkProviderDisposers;
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
        terminal.dispose.mock.invocationCallOrder[0],
      );
    });

    it("sends OSC 8 links to the app's handler instead of xterm's confirm fallback", () => {
      render(<TerminalPane projectId="project-1" visible />);
      const handler = mocks.terminals[0].options.linkHandler as {
        activate: unknown;
        allowNonHttpProtocols: boolean;
      };
      expect(handler).toMatchObject({ allowNonHttpProtocols: false });
      expect(handler.activate).toEqual(expect.any(Function));
    });

    it("shows the location and the click hint on hover, and hides them on leave", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      const move = new MouseEvent("mousemove", { clientX: 40, clientY: 50 });

      act(() => mocks.linkTooltip?.hover({ label: "chapters/intro.tex:12:4", kind: "file" }, move));
      const tip = await screen.findByRole("tooltip");
      expect(tip).toHaveTextContent("chapters/intro.tex:12:4");
      expect(tip).toHaveTextContent(/(⌘|Ctrl)-click to open$/);

      act(() => mocks.linkTooltip?.leave());
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("names the browser for a web link, including OSC 8 ones", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      const handler = mocks.terminals[0].options.linkHandler as {
        hover: (event: MouseEvent, text: string) => void;
      };

      act(() => handler.hover(new MouseEvent("mousemove"), "https://typst.app/docs"));
      const tip = await screen.findByRole("tooltip");
      expect(tip).toHaveTextContent("https://typst.app/docs");
      expect(tip).toHaveTextContent(/-click to open in your browser$/);
    });

    it("hides the tooltip when the output scrolls or the pane is hidden", async () => {
      const view = render(<TerminalPane projectId="project-1" visible />);
      const hover = () =>
        act(() => mocks.linkTooltip?.hover({ label: "main.tex", kind: "file" }, new MouseEvent("mousemove")));

      hover();
      await screen.findByRole("tooltip");
      act(() => mocks.terminals[0].scrollHandler?.());
      expect(screen.queryByRole("tooltip")).toBeNull();

      hover();
      await screen.findByRole("tooltip");
      view.rerender(<TerminalPane projectId="project-1" visible={false} />);
      expect(screen.queryByRole("tooltip")).toBeNull();
      view.rerender(<TerminalPane projectId="project-1" visible />);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("session messages and layout", () => {
    it("writes an input failure the backend reports on the session channel", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      const terminal = mocks.terminals[0];
      await waitFor(() => expect(mocks.channels).toHaveLength(1));

      act(() =>
        mocks.channels[0].onmessage?.({ event: "input_error", message: "pty closed" }),
      );

      expect(terminal.writeln).toHaveBeenCalledWith(
        "\r\nThe shell could not accept input: pty closed",
        expect.any(Function),
      );
    });

    it("mirrors visible output into the pane for end-to-end checks", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      const terminal = mocks.terminals[0] as (typeof mocks.terminals)[number] & {
        buffer: { active: unknown };
      };
      await waitFor(() => expect(mocks.channels).toHaveLength(1));
      const pane = screen.getByTestId("dock-terminal");
      expect(pane.dataset.terminalOutput).toBe("");

      act(() => output("$ ls\r\nmain.tex"));
      const [data, written] = terminal.write.mock.calls[0] as [string, () => void];
      expect(data).toBe("$ ls\r\nmain.tex");
      const lines = ["$ ls", "main.tex"];
      terminal.buffer.active = {
        length: 3,
        getLine: (index: number) =>
          index < lines.length ? { translateToString: () => lines[index] } : undefined,
      };
      written();

      expect(pane.dataset.terminalOutput).toBe("$ ls\nmain.tex\n");
    });

    it("refits and resizes the live session when the pane changes size", async () => {
      render(<TerminalPane projectId="project-1" visible />);
      await waitFor(() =>
        expect(mocks.invoke.mock.calls.some(([command]) => command === "term_resize")).toBe(true),
      );
      const fit = mocks.fitAddons[0];
      const terminal = mocks.terminals[0];
      const resizes = () => mocks.invoke.mock.calls.filter(([command]) => command === "term_resize");
      const before = resizes().length;
      fit.fit.mockClear();
      terminal.cols = 120;
      terminal.rows = 40;

      act(() => mocks.resizeObservers[0].callback([], {} as ResizeObserver));

      expect(fit.fit).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(resizes().length).toBeGreaterThan(before));
      expect(resizes().at(-1)?.[1]).toEqual({ id: "term-1", projectId: "project-1", cols: 120, rows: 40 });
    });

    it("does not refit a hidden pane when its size changes", async () => {
      render(<TerminalPane projectId="project-1" visible={false} />);
      await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("term_open", expect.anything()));
      const fit = mocks.fitAddons[0];

      act(() => mocks.resizeObservers[0].callback([], {} as ResizeObserver));

      expect(fit.fit).not.toHaveBeenCalled();
    });
  });
});
