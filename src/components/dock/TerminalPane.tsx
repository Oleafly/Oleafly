import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { decodeAppError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";

import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useAppTheme } from "@/lib/theme";
import { createTerminalResizer } from "@/lib/terminal-resize";
import { ownSelectAll } from "@/lib/select-all";
import { createAckBatcher } from "@/lib/terminal-flow";
import {
  termAck,
  termKill,
  termOpen,
  termResize,
  termWrite,
  type TerminalChannelMessage,
  type TerminalOpenOptions,
} from "@/lib/terminal-ipc";
import { terminalPlatform } from "@/lib/terminal-keys";
import { parseOsc52 } from "@/lib/terminal-osc52";
import { windowsPtyOption } from "@/lib/terminal-platform";
import { shellCommandLine, type TerminalCommand, type TerminalShellKind } from "@/lib/terminal-quote";
import { registerTerminalSession } from "@/lib/terminal-sessions";
import { isAllowListedTerminalShortcut } from "@/lib/terminal-shortcut-guard";
import {
  resolveTerminalTheme,
  useSettingsStore,
  withTerminalGlyphFallbacks,
  type TerminalShellId,
} from "@/store/settings";
import { createTerminalLinkActions } from "./terminal-link-actions";
import { createTerminalLinkHandler, createTerminalLinkProvider } from "./terminal-link-provider";
import { TerminalLinkTooltip, type TerminalLinkTip } from "./TerminalLinkTooltip";
import { attachTerminalKeys } from "./terminal-input";
import { copyTerminalText } from "./terminal-clipboard";
import { canDropOnTerminal, readTerminalDrop, terminalDropText } from "./terminal-drop";
import type { TerminalSearch } from "./TerminalFindBar";
import { Spinner } from "@/components/ui/spinner";
import "@xterm/xterm/css/xterm.css";

const TerminalFindBar = lazy(() => import("./TerminalFindBar"));

function terminalBufferText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

function terminalOutputCallback(
  terminal: Terminal,
  target: HTMLElement | null,
): (() => void) | undefined {
  if (!E2E_HOOKS || !target) return undefined;
  return () => {
    target.dataset.terminalOutput = terminalBufferText(terminal);
  };
}

function recordTerminalEvent(entry: string) {
  if (!E2E_HOOKS) return;
  const w = window as typeof window & { __e2eTerminalEvents?: string[] };
  w.__e2eTerminalEvents = w.__e2eTerminalEvents ?? [];
  w.__e2eTerminalEvents.push(entry);
}

function writeTerminalError(
  terminal: Terminal,
  message: string,
  error: unknown,
  onWritten?: () => void,
) {
  terminal.writeln(`\r\n${message}: ${String(error)}`, onWritten);
}

function writeTerminalErrorOnce(
  terminal: Terminal,
  surfacedErrors: Set<string>,
  message: string,
  error: unknown,
  onWritten?: () => void,
) {
  const key = `${message}\u0000${String(error)}`;
  if (surfacedErrors.has(key)) return;
  surfacedErrors.add(key);
  writeTerminalError(terminal, message, error, onWritten);
}

function killTerminalSession(id: string, projectId: string): void {
  void termKill(projectId, id).catch(() => {});
}

export interface TerminalPaneProps {
  projectId: string;
  /** Registers the session for busy checks and drops. */
  tabId?: string;
  visible?: boolean;
  active?: boolean;
  autoStart?: boolean;
  /** Project-relative start folder. */
  cwd?: string;
  /** Extra environment for the shell. */
  env?: Record<string, string>;
  /** Typed once the shell is ready, quoted for the shell that started. */
  launch?: TerminalCommand;
  /** Typed into the shell once, as is (kept for existing callers). */
  initialInput?: string;
  onExit?: () => void;
  onStarted?: () => void;
  /** A program rang the bell while the pane was hidden. */
  onBell?: () => void;
  /** The running program set the terminal title (throttled, clamped). */
  onTitle?: (title: string) => void;
}

/** Typed launch input waits for the first parsed output, or this long. */
export const LAUNCH_INPUT_FALLBACK_MS = 1_500;
export const TITLE_THROTTLE_MS = 250;
const TITLE_MAX_LENGTH = 200;
// Matches the app's Tooltip, so sweeping the pointer over a log stays quiet.
const LINK_TOOLTIP_DELAY_MS = 300;

const SEARCH_DECORATIONS = {
  matchBackground: "#f5c54266",
  activeMatchBackground: "#f5a623aa",
  matchOverviewRuler: "#f5c542",
  activeMatchColorOverviewRuler: "#f5a623",
};

function searchFor(addon: SearchAddon): TerminalSearch {
  return {
    findNext: (term, incremental) =>
      addon.findNext(term, { decorations: SEARCH_DECORATIONS, incremental: Boolean(incremental) }),
    findPrevious: (term) => addon.findPrevious(term, { decorations: SEARCH_DECORATIONS }),
    clear: () => addon.clearDecorations(),
    onResults: (listener) => {
      const subscription = addon.onDidChangeResults(({ resultIndex, resultCount }) =>
        listener(resultIndex, resultCount),
      );
      return () => subscription.dispose();
    },
  };
}

/**
 * GPU renderer: much faster than the DOM renderer for busy output and it draws
 * glyph fallbacks from the font stack the same way. Falls back silently to the
 * DOM renderer when WebGL is unavailable (older WebKitGTK, software GPUs) or
 * when the context is lost later.
 */
function attachRenderer(terminal: Terminal): void {
  if (E2E_HOOKS) return;
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
  } catch {
    // DOM renderer stays active.
  }
}

export function TerminalPane({
  projectId,
  tabId,
  visible = true,
  active = true,
  autoStart = false,
  cwd,
  env,
  launch,
  initialInput,
  onExit,
  onStarted,
  onBell,
  onTitle,
}: Readonly<TerminalPaneProps>) {
  const { t } = useTranslation(["workspace"]);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionLiveRef = useRef(false);
  const shellKindRef = useRef<TerminalShellKind>("posix");
  const shellIdRef = useRef<TerminalShellId | null>(null);
  const shellNameRef = useRef<string | null>(null);
  const resizerRef = useRef<ReturnType<typeof createTerminalResizer> | null>(null);
  const surfacedErrorsRef = useRef(new Set<string>());
  const outputWrittenRef = useRef<(() => void) | undefined>(undefined);
  const visibleRef = useRef(visible);
  const autoStartRef = useRef(autoStart);
  const onExitRef = useRef(onExit);
  visibleRef.current = visible;
  autoStartRef.current = autoStart;
  onExitRef.current = onExit;
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const onBellRef = useRef(onBell);
  onBellRef.current = onBell;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const envRef = useRef(env);
  envRef.current = env;
  const launchRef = useRef(launch);
  launchRef.current = launch;
  const initialInputRef = useRef(initialInput);
  const initialInputSentRef = useRef(false);
  const platformRef = useRef(terminalPlatform());
  const startWithProject = useSettingsStore((state) => state.terminalStartWithProject);
  const [backgroundRefusedFor, setBackgroundRefusedFor] = useState<string | null>(null);
  const backgroundStartRefused = backgroundRefusedFor === projectId;
  const shouldStart = visible || autoStart || (startWithProject && !backgroundStartRefused);
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [activated, setActivated] = useState(shouldStart);
  const [opened, setOpened] = useState(false);
  const [linkTip, setLinkTip] = useState<TerminalLinkTip | null>(null);
  const [search, setSearch] = useState<TerminalSearch | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const openFindRef = useRef<() => void>(() => {});
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const terminalFontWeight = useSettingsStore((state) => state.terminalFontWeight);
  const terminalFontWeightBold = useSettingsStore((state) => state.terminalFontWeightBold);
  const terminalCursorStyle = useSettingsStore((state) => state.terminalCursorStyle);
  const terminalCursorBlink = useSettingsStore((state) => state.terminalCursorBlink);
  const terminalColorTheme = useSettingsStore((state) => state.terminalColorTheme);
  const terminalBackground = useSettingsStore((state) => state.terminalBackground);
  const terminalForeground = useSettingsStore((state) => state.terminalForeground);
  const terminalCursorColor = useSettingsStore((state) => state.terminalCursorColor);
  const terminalScrollback = useSettingsStore((state) => state.terminalScrollback);
  const terminalOptionIsMeta = useSettingsStore((state) => state.terminalOptionIsMeta);
  const appTheme = useAppTheme();
  const appThemeRef = useRef(appTheme);
  appThemeRef.current = appTheme;
  const appearanceRef = useRef({
    terminalFontSize,
    terminalFontFamily,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalCursorStyle,
    terminalCursorBlink,
    terminalColorTheme,
    terminalBackground,
    terminalForeground,
    terminalCursorColor,
    terminalScrollback,
    terminalOptionIsMeta,
  });
  appearanceRef.current = {
    terminalFontSize,
    terminalFontFamily,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalCursorStyle,
    terminalCursorBlink,
    terminalColorTheme,
    terminalBackground,
    terminalForeground,
    terminalCursorColor,
    terminalScrollback,
    terminalOptionIsMeta,
  };

  /** Remembers the pane's size while it shows, so a hidden pane keeps it. */
  const rememberSize = useCallback(() => {
    const rect = paneRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      lastSizeRef.current = { width: rect.width, height: rect.height };
    }
  }, []);

  const markOpened = useCallback(() => {
    openedRef.current = true;
    rememberSize();
    setOpened(true);
  }, [rememberSize]);

  useEffect(() => {
    if (shouldStart && !activated) setActivated(true);
  }, [activated, shouldStart]);

  useEffect(() => {
    if (!activated || ended) return;
    const host = hostRef.current;
    if (!host) return;
    setBooted(false);
    sessionLiveRef.current = false;
    surfacedErrorsRef.current.clear();
    const platform = platformRef.current;
    const appearance = appearanceRef.current;
    const theme = resolveTerminalTheme(appearance, appThemeRef.current);
    let disposed = false;
    let linkTipTimer: number | null = null;
    const hideLinkTip = () => {
      if (linkTipTimer !== null) window.clearTimeout(linkTipTimer);
      linkTipTimer = null;
      setLinkTip(null);
    };
    const linkActions = createTerminalLinkActions(projectId, {
      hover: (info, event) => {
        hideLinkTip();
        const tip = { ...info, x: event.clientX, y: event.clientY };
        linkTipTimer = window.setTimeout(() => {
          linkTipTimer = null;
          if (!disposed && visibleRef.current) setLinkTip(tip);
        }, LINK_TOOLTIP_DELAY_MS);
      },
      leave: hideLinkTip,
    });
    const terminal = new Terminal({
      fontSize: appearance.terminalFontSize,
      fontFamily: withTerminalGlyphFallbacks(appearance.terminalFontFamily),
      fontWeight: appearance.terminalFontWeight,
      fontWeightBold: appearance.terminalFontWeightBold,
      cursorStyle: appearance.terminalCursorStyle,
      cursorBlink: appearance.terminalCursorBlink,
      drawBoldTextInBrightColors: true,
      scrollback: appearance.terminalScrollback,
      macOptionIsMeta: platform === "mac" && appearance.terminalOptionIsMeta,
      // ConPTY and the Windows build: stops a second reflow on resize.
      windowsPty: windowsPtyOption(platform),
      // Unicode 11 width tables: Nerd Font icons, emoji and CJK take the right
      // number of cells, so right-aligned prompts (Powerlevel10k, Starship) line up.
      allowProposedApi: true,
      theme,
      linkHandler: createTerminalLinkHandler(linkActions),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    try {
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = "11";
    } catch {
      // Version 6 tables remain; only alignment of wide glyphs is affected.
    }
    const outputTarget = host.parentElement;
    const outputWritten = terminalOutputCallback(terminal, outputTarget);
    outputWrittenRef.current = outputWritten;
    if (outputWritten && outputTarget) outputTarget.dataset.terminalOutput = "";
    openedRef.current = false;
    setOpened(false);
    // Never open xterm in a zero-size host (WebView2 crashes on its
    // dimensions); a hidden pane opens on its first show.
    if (visibleRef.current) {
      terminal.open(host);
      markOpened();
      attachRenderer(terminal);
      fit.fit();
      terminal.focus();
    }
    terminalRef.current = terminal;
    fitRef.current = fit;
    const linkProvider = terminal.registerLinkProvider(
      createTerminalLinkProvider(terminal, linkActions),
    );
    const scrollSub = terminal.onScroll(hideLinkTip);
    const releaseSelectAll = ownSelectAll(host, () => terminal.selectAll());

    attachTerminalKeys(
      {
        input: (data) => terminal.input(data, true),
        hasSelection: () => terminal.hasSelection(),
        getSelection: () => terminal.getSelection(),
        clearSelection: () => terminal.clearSelection(),
        clear: () => terminal.clear(),
        attachCustomKeyEventHandler: (handler) => terminal.attachCustomKeyEventHandler(handler),
      },
      {
        context: () => {
          const settings = useSettingsStore.getState();
          return {
            platform,
            shiftEnter: settings.terminalShiftEnter,
            wsl: shellIdRef.current === "wsl",
            shellName: shellNameRef.current,
            optionIsMeta: settings.terminalOptionIsMeta,
            isAppShortcut: isAllowListedTerminalShortcut,
          };
        },
        copy: (text) => void copyTerminalText(text),
        find: () => openFindRef.current(),
      },
    );

    // OSC 52: a program may put text on the clipboard, only from a pane the
    // user can see, and may never read it back.
    const osc52 = terminal.parser.registerOscHandler(52, (data) => {
      const request = parseOsc52(data);
      if (request.kind === "write" && visibleRef.current) void copyTerminalText(request.text);
      return true;
    });
    const bellSub = terminal.onBell(() => {
      if (!visibleRef.current) onBellRef.current?.();
    });
    let titleTimer: number | null = null;
    let pendingTitle: string | null = null;
    let lastTitleAt = Number.NEGATIVE_INFINITY;
    const flushTitle = () => {
      titleTimer = null;
      if (pendingTitle === null) return;
      const title = pendingTitle;
      pendingTitle = null;
      lastTitleAt = Date.now();
      onTitleRef.current?.(title);
    };
    const titleSub = terminal.onTitleChange((title) => {
      pendingTitle = title.slice(0, TITLE_MAX_LENGTH);
      if (titleTimer !== null) return;
      const wait = Math.max(0, TITLE_THROTTLE_MS - (Date.now() - lastTitleAt));
      titleTimer = window.setTimeout(flushTitle, wait);
    });
    // Copy on select: mouseup still carries the gesture WebKit's clipboard needs.
    const copyOnSelect = () => {
      if (useSettingsStore.getState().terminalCopyOnSelect && terminal.hasSelection()) {
        void copyTerminalText(terminal.getSelection());
      }
    };
    host.addEventListener("mouseup", copyOnSelect);

    let sessionId: string | null = null;
    let sessionLive = false;
    let sessionExited = false;
    let unregisterSession: (() => void) | null = null;
    let resizer: ReturnType<typeof createTerminalResizer> | null = null;
    const pendingInput: string[] = [];
    const writeInput = (id: string, data: string) => {
      void termWrite(projectId, id, data).catch((error) => {
        if (!disposed && sessionLive) {
          writeTerminalErrorOnce(
            terminal,
            surfacedErrorsRef.current,
            i18n.t(($) => $.workspace.terminal.errors.input),
            error,
            outputWritten,
          );
        }
      });
    };
    const acks = createAckBatcher((bytes) => {
      if (sessionId) void termAck(projectId, sessionId, bytes).catch(() => {});
    });

    // Launch input (a sign-in or install command) goes in once, after the
    // terminal replies queued at start-up (ConPTY's DA1 answer comes out
    // while xterm parses the first output), or after a quiet start.
    let firstOutputParsed = false;
    let launchTimer: number | null = null;
    const launchLine = (): string | null => {
      if (initialInputRef.current) return initialInputRef.current;
      const command = launchRef.current;
      return command ? `${shellCommandLine(shellKindRef.current, command)}\r` : null;
    };
    const sendLaunchInput = () => {
      if (initialInputSentRef.current || disposed || !sessionLive || !sessionId) return;
      const line = launchLine();
      if (!line) return;
      initialInputSentRef.current = true;
      if (launchTimer !== null) {
        window.clearTimeout(launchTimer);
        launchTimer = null;
      }
      writeInput(sessionId, line);
    };
    const noteOutputParsed = () => {
      if (firstOutputParsed) return;
      firstOutputParsed = true;
      sendLaunchInput();
    };
    // Hidden panes parse too, so modes, titles and terminal replies stay
    // right and nothing is lost while the tab is in the background.
    const writeOutput = (data: string, bytes: number) => {
      terminal.write(data, () => {
        acks.written(bytes);
        outputWritten?.();
        noteOutputParsed();
      });
    };
    const channel = new Channel<TerminalChannelMessage>();
    channel.onmessage = (message) => {
      recordTerminalEvent(
        message.event === "output"
          ? "output"
          : `exit(disposed=${disposed},exited=${sessionExited})`,
      );
      if (disposed || sessionExited) return;
      if (message.event === "output") {
        setBooted(true);
        writeOutput(message.data, typeof message.bytes === "number" ? message.bytes : 0);
        return;
      }
      if (message.event === "input_error") {
        writeTerminalErrorOnce(terminal, surfacedErrorsRef.current, i18n.t(($) => $.workspace.terminal.errors.input), message.message, outputWritten);
        return;
      }
      sessionExited = true;
      resizer?.dispose();
      resizerRef.current = null;
      sessionLive = false;
      sessionLiveRef.current = false;
      sessionId = null;
      sessionIdRef.current = null;
      unregisterSession?.();
      unregisterSession = null;
      acks.dispose();
      setEnded(true);
      onExitRef.current?.();
    };
    const openedCols = terminal.cols;
    const openedRows = terminal.rows;
    const settings = useSettingsStore.getState();
    // Launched commands are Windows programs (installers, sign-in), so they
    // never start in WSL.
    const shell: TerminalOpenOptions["shell"] =
      launchRef.current && settings.terminalShell === "wsl"
        ? { id: "auto" }
        : { id: settings.terminalShell, path: settings.terminalShellPath };
    let openTimer: number | null = window.setTimeout(() => {
      openTimer = null;
      void termOpen({
        projectId,
        cols: openedCols,
        rows: openedRows,
        autostart: !visibleRef.current && !autoStartRef.current,
        options: { cwd: cwdRef.current, env: envRef.current, shell },
        channel,
      })
      .then((session) => {
        const id = session.id;
        recordTerminalEvent(`open:ok:${id}`);
        if (disposed || sessionExited) {
          killTerminalSession(id, projectId);
          return;
        }
        sessionId = id;
        sessionIdRef.current = id;
        sessionLive = true;
        sessionLiveRef.current = true;
        shellKindRef.current = session.shell;
        shellIdRef.current = session.shellId;
        shellNameRef.current = session.shellName ?? null;
        if (tabIdRef.current) unregisterSession = registerTerminalSession(tabIdRef.current, projectId, id);
        acks.ready();
        resizer = createTerminalResizer(
          (cols, rows) => termResize(projectId, id, cols, rows),
          (error) => {
            if (!disposed && sessionLive) {
              writeTerminalErrorOnce(terminal, surfacedErrorsRef.current,
                i18n.t(($) => $.workspace.terminal.errors.resize), error, outputWritten);
            }
          },
        );
        resizerRef.current = resizer;
        // Terminal replies queued during start-up (ConPTY's DA1 answer) go first.
        for (const data of pendingInput.splice(0)) writeInput(id, data);
        if (firstOutputParsed) {
          sendLaunchInput();
        } else if (!initialInputSentRef.current && launchLine()) {
          launchTimer = window.setTimeout(() => {
            launchTimer = null;
            sendLaunchInput();
          }, LAUNCH_INPUT_FALLBACK_MS);
        }
        setBooted(true);
        onStartedRef.current?.();
        if (visibleRef.current || terminal.cols !== openedCols || terminal.rows !== openedRows) {
          resizer.request(terminal.cols, terminal.rows);
        }
        if (visibleRef.current) terminal.focus();
      })
      .catch((error) => {
        recordTerminalEvent(`open:error:${String(error)}`);
        pendingInput.length = 0;
        if (disposed || sessionExited) return;
        if (decodeAppError(error)?.code === "trust.terminal") {
          setBackgroundRefusedFor(projectId);
          setActivated(false);
          return;
        }
        setBooted(true);
        writeTerminalError(terminal, i18n.t(($) => $.workspace.terminal.errors.start), error, outputWritten);
      });
    }, 0);

    const dataSub = terminal.onData((data) => {
      if (sessionLive && sessionId) {
        writeInput(sessionId, data);
        return;
      }
      if (!sessionId && !sessionExited && !disposed) pendingInput.push(data);
    });
    const observer = new ResizeObserver(() => {
      if (!visibleRef.current || !openedRef.current) return;
      rememberSize();
      fit.fit();
      if (sessionLive && sessionId) {
        resizer?.request(terminal.cols, terminal.rows);
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      resizer?.dispose();
      if (resizerRef.current === resizer) resizerRef.current = null;
      if (openTimer !== null) {
        window.clearTimeout(openTimer);
        openTimer = null;
      }
      if (launchTimer !== null) {
        window.clearTimeout(launchTimer);
        launchTimer = null;
      }
      if (titleTimer !== null) {
        window.clearTimeout(titleTimer);
        titleTimer = null;
      }
      sessionLive = false;
      sessionLiveRef.current = false;
      pendingInput.length = 0;
      acks.dispose();
      unregisterSession?.();
      unregisterSession = null;
      observer.disconnect();
      dataSub.dispose();
      scrollSub.dispose();
      osc52.dispose();
      bellSub.dispose();
      titleSub.dispose();
      host.removeEventListener("mouseup", copyOnSelect);
      releaseSelectAll();
      linkProvider.dispose();
      hideLinkTip();
      if (sessionId) killTerminalSession(sessionId, projectId);
      sessionIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      openedRef.current = false;
      setSearch(null);
      setFindOpen(false);
      if (outputWrittenRef.current === outputWritten) outputWrittenRef.current = undefined;
      terminal.dispose();
    };
  }, [activated, ended, markOpened, projectId, rememberSize]);

  // Find loads the search addon (and the bar) on first use.
  const openFind = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (search) {
      setFindOpen(true);
      return;
    }
    void import("@xterm/addon-search")
      .then(({ SearchAddon }) => {
        if (terminalRef.current !== terminal) return;
        const addon = new SearchAddon({ highlightLimit: 1000 });
        terminal.loadAddon(addon);
        setSearch(searchFor(addon));
        setFindOpen(true);
      })
      .catch(() => {});
  }, [search]);
  openFindRef.current = openFind;

  const closeFind = useCallback(() => {
    setFindOpen(false);
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = terminalFontSize;
    terminal.options.fontFamily = withTerminalGlyphFallbacks(terminalFontFamily);
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = terminalFontWeightBold;
    terminal.options.cursorStyle = terminalCursorStyle;
    terminal.options.cursorBlink = terminalCursorBlink;
    terminal.options.drawBoldTextInBrightColors = true;
    terminal.options.theme = resolveTerminalTheme(
      { terminalColorTheme, terminalBackground, terminalForeground, terminalCursorColor },
      appTheme,
    );
    if (!visibleRef.current || !openedRef.current) return;
    fitRef.current?.fit();
    const id = sessionIdRef.current;
    if (id && sessionLiveRef.current) {
      resizerRef.current?.request(terminal.cols, terminal.rows);
    }
  }, [
    appTheme,
    terminalBackground,
    terminalColorTheme,
    terminalCursorBlink,
    terminalCursorColor,
    terminalCursorStyle,
    terminalFontFamily,
    terminalFontSize,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalForeground,
  ]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = terminalScrollback;
    terminal.options.macOptionIsMeta = platformRef.current === "mac" && terminalOptionIsMeta;
  }, [terminalOptionIsMeta, terminalScrollback]);

  // A hidden pane cannot be hovered, so its tooltip must not wait for a leave.
  useEffect(() => {
    if (!visible) return;
    return () => setLinkTip(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const host = hostRef.current;
      if (terminal && host && !openedRef.current) {
        terminal.open(host);
        markOpened();
        attachRenderer(terminal);
      }
      if (!openedRef.current) return;
      rememberSize();
      fitRef.current?.fit();
      terminal?.focus();
      const id = sessionIdRef.current;
      if (terminal && id && sessionLiveRef.current) {
        resizerRef.current?.request(terminal.cols, terminal.rows);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [markOpened, rememberSize, visible]);

  const paneBackground = resolveTerminalTheme(
    { terminalColorTheme, terminalBackground, terminalForeground, terminalCursorColor },
    appTheme,
  ).background;
  // An opened pane that is hidden is parked: kept at its last size just
  // outside the dock's clipping box, invisible and inert. Its host never
  // shrinks to zero, so output keeps parsing without the WebView2 crash.
  const parked = !visible && opened;
  const parkedSize = parked ? lastSizeRef.current : null;
  let paneClass = "h-0 shrink-0 overflow-hidden p-0";
  if (visible) paneClass = "h-full min-h-0 flex-1 p-2";
  else if (parked) paneClass = "absolute left-full top-0 invisible pointer-events-none p-2";

  const dropTargetActive = (transfer: DataTransfer | null) =>
    sessionLiveRef.current && canDropOnTerminal(transfer, platformRef.current);

  return (
    <div
      ref={paneRef}
      className={cn("relative w-full", paneClass)}
      data-testid={active ? "dock-terminal" : "dock-terminal-inactive"}
      data-terminal-font-size={terminalFontSize}
      data-terminal-color-theme={terminalColorTheme}
      aria-hidden={!visible}
      inert={parked ? true : undefined}
      onMouseDown={(event) => {
        const target = event.target as Partial<Pick<Element, "closest">> | null;
        if (target?.closest?.("[data-terminal-find]")) return;
        terminalRef.current?.focus();
      }}
      onDragOverCapture={(event) => {
        if (!dropTargetActive(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(event) => {
        if (!dropTargetActive(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const drop = readTerminalDrop(event.dataTransfer, platformRef.current);
        const terminal = terminalRef.current;
        if (!drop || !terminal) return;
        terminal.paste(terminalDropText(drop, shellKindRef.current, platformRef.current, cwdRef.current ?? ""));
        terminal.focus();
      }}
      style={{
        backgroundColor: paneBackground,
        ...(parkedSize ? { width: parkedSize.width, height: parkedSize.height } : {}),
      }}
    >
      <div
        ref={hostRef}
        className="h-full w-full"
        data-testid={active ? "dock-terminal-host" : "dock-terminal-host-inactive"}
      />
      {!booted && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"
          data-testid={active ? "dock-terminal-loading" : "dock-terminal-loading-inactive"}
          style={{ backgroundColor: paneBackground }}
        >
          <Spinner size="xl" />
          <p className="text-xs">{t(($) => $.workspace.terminal.starting)}</p>
        </div>
      )}
      {visible && findOpen && search && (
        <Suspense fallback={null}>
          <TerminalFindBar search={search} onClose={closeFind} />
        </Suspense>
      )}
      {visible && linkTip && <TerminalLinkTooltip tip={linkTip} />}
    </div>
  );
}
