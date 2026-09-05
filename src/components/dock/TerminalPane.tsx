import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Loader2 } from "lucide-react";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useAppTheme } from "@/lib/theme";
import {
  resolveTerminalTheme,
  useSettingsStore,
  withTerminalGlyphFallbacks,
} from "@/store/settings";
import "@xterm/xterm/css/xterm.css";

type TerminalChannelMessage =
  | { event: "output"; data: string }
  | { event: "exit" };

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

export interface TerminalPaneProps {
  projectId: string;
  projectName?: string;
  visible?: boolean;
  active?: boolean;
  autoStart?: boolean;
  onExit?: () => void;
}

const MAX_HIDDEN_OUTPUT_CHARS = 256_000;
const SCROLLBACK_LINES = 5_000;

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
  projectName,
  visible = true,
  active = true,
  autoStart = false,
  onExit,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const hiddenOutputRef = useRef<string[]>([]);
  const hiddenOutputLengthRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionLiveRef = useRef(false);
  const surfacedErrorsRef = useRef(new Set<string>());
  const outputWrittenRef = useRef<(() => void) | undefined>(undefined);
  const visibleRef = useRef(visible);
  const onExitRef = useRef(onExit);
  visibleRef.current = visible;
  onExitRef.current = onExit;
  const startWithProject = useSettingsStore((state) => state.terminalStartWithProject);
  const shouldStart = visible || autoStart || startWithProject;
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [activated, setActivated] = useState(shouldStart);
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
  };

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
    const appearance = appearanceRef.current;
    const theme = resolveTerminalTheme(appearance, appThemeRef.current);
    const terminal = new Terminal({
      fontSize: appearance.terminalFontSize,
      fontFamily: withTerminalGlyphFallbacks(appearance.terminalFontFamily),
      fontWeight: appearance.terminalFontWeight,
      fontWeightBold: appearance.terminalFontWeightBold,
      cursorStyle: appearance.terminalCursorStyle,
      cursorBlink: appearance.terminalCursorBlink,
      drawBoldTextInBrightColors: true,
      scrollback: SCROLLBACK_LINES,
      // Unicode 11 width tables: Nerd Font icons, emoji and CJK take the right
      // number of cells, so right-aligned prompts (Powerlevel10k, Starship) line up.
      allowProposedApi: true,
      theme,
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
    if (visibleRef.current) {
      terminal.open(host);
      openedRef.current = true;
      attachRenderer(terminal);
      fit.fit();
      terminal.focus();
    }
    terminalRef.current = terminal;
    fitRef.current = fit;

    let sessionId: string | null = null;
    let sessionLive = false;
    let sessionExited = false;
    let disposed = false;
    const pendingInput: string[] = [];
    const writeInput = (id: string, data: string) => {
      void invoke("term_write", { id, projectId, data }).catch((error) => {
        if (!disposed && sessionLive) {
          writeTerminalErrorOnce(
            terminal,
            surfacedErrorsRef.current,
            "The shell could not accept input",
            error,
            outputWritten,
          );
        }
      });
    };
    const writeOutput = (data: string) => {
      if (!visibleRef.current || !openedRef.current) {
        hiddenOutputRef.current.push(data);
        hiddenOutputLengthRef.current += data.length;
        while (
          hiddenOutputLengthRef.current > MAX_HIDDEN_OUTPUT_CHARS &&
          hiddenOutputRef.current.length > 1
        ) {
          const dropped = hiddenOutputRef.current.shift();
          hiddenOutputLengthRef.current -= dropped ? dropped.length : 0;
        }
        return;
      }
      if (E2E_HOOKS) {
        terminal.write(data, outputWritten);
      } else {
        terminal.write(data);
      }
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
        writeOutput(message.data);
        return;
      }
      sessionExited = true;
      sessionLive = false;
      sessionLiveRef.current = false;
      sessionId = null;
      sessionIdRef.current = null;
      setEnded(true);
      onExitRef.current?.();
    };
    const openedCols = terminal.cols;
    const openedRows = terminal.rows;
    let openTimer: number | null = window.setTimeout(() => {
      openTimer = null;
      void invoke<string>("term_open", {
        projectId,
        cols: openedCols,
        rows: openedRows,
        channel,
      })
      .then((id) => {
        recordTerminalEvent(`open:ok:${id}`);
        if (disposed || sessionExited) {
          void invoke("term_kill", { id, projectId }).catch(() => {});
          return;
        }
        sessionId = id;
        sessionIdRef.current = id;
        sessionLive = true;
        sessionLiveRef.current = true;
        for (const data of pendingInput.splice(0)) writeInput(id, data);
        setBooted(true);
        if (visibleRef.current || terminal.cols !== openedCols || terminal.rows !== openedRows) {
          void invoke("term_resize", {
            id,
            projectId,
            cols: terminal.cols,
            rows: terminal.rows,
          }).catch((error) => {
            if (!disposed && sessionLive) {
              writeTerminalErrorOnce(
                terminal,
                surfacedErrorsRef.current,
                "The terminal could not resize",
                error,
                outputWritten,
              );
            }
          });
        }
        if (visibleRef.current) terminal.focus();
      })
      .catch((error) => {
        recordTerminalEvent(`open:error:${String(error)}`);
        pendingInput.length = 0;
        if (disposed || sessionExited) return;
        setBooted(true);
        writeTerminalError(terminal, "The shell could not start", error, outputWritten);
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
      fit.fit();
      if (sessionLive && sessionId) {
        void invoke("term_resize", {
          id: sessionId,
          projectId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch((error) => {
          if (!disposed && sessionLive) {
            writeTerminalErrorOnce(
              terminal,
              surfacedErrorsRef.current,
              "The terminal could not resize",
              error,
              outputWritten,
            );
          }
        });
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      if (openTimer !== null) {
        window.clearTimeout(openTimer);
        openTimer = null;
      }
      sessionLive = false;
      sessionLiveRef.current = false;
      pendingInput.length = 0;
      hiddenOutputRef.current = [];
      hiddenOutputLengthRef.current = 0;
      observer.disconnect();
      dataSub.dispose();
      if (sessionId) void invoke("term_kill", { id: sessionId, projectId }).catch(() => {});
      sessionIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      openedRef.current = false;
      if (outputWrittenRef.current === outputWritten) outputWrittenRef.current = undefined;
      terminal.dispose();
    };
  }, [activated, ended, projectId]);

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
      void invoke("term_resize", {
        id,
        projectId,
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch((error) => {
        if (
          sessionLiveRef.current &&
          sessionIdRef.current === id &&
          terminalRef.current === terminal
        ) {
          writeTerminalErrorOnce(
            terminal,
            surfacedErrorsRef.current,
            "The terminal could not resize",
            error,
            outputWrittenRef.current,
          );
        }
      });
    }
  }, [
    appTheme,
    projectId,
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
    if (!projectName || !activated) return;
    terminalRef.current?.write(`\x1b]2;${projectName} - project shell\x07`);
  }, [activated, projectName]);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const host = hostRef.current;
      if (terminal && host && !openedRef.current) {
        terminal.open(host);
        openedRef.current = true;
        attachRenderer(terminal);
      }
      if (!openedRef.current) return;
      if (terminal && hiddenOutputRef.current.length > 0) {
        const buffered = hiddenOutputRef.current.join("");
        hiddenOutputRef.current = [];
        hiddenOutputLengthRef.current = 0;
        if (E2E_HOOKS) {
          terminal.write(buffered, outputWrittenRef.current);
        } else {
          terminal.write(buffered);
        }
      }
      fitRef.current?.fit();
      terminal?.focus();
      const id = sessionIdRef.current;
      if (terminal && id && sessionLiveRef.current) {
        void invoke("term_resize", {
          id,
          projectId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch((error) => {
          if (
            sessionLiveRef.current &&
            sessionIdRef.current === id &&
            terminalRef.current === terminal
          ) {
            writeTerminalErrorOnce(
              terminal,
              surfacedErrorsRef.current,
              "The terminal could not resize",
              error,
              outputWrittenRef.current,
            );
          }
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectId, visible]);

  const paneBackground = resolveTerminalTheme(
    { terminalColorTheme, terminalBackground, terminalForeground, terminalCursorColor },
    appTheme,
  ).background;

  return (
    <div
      className={cn(
        "relative w-full",
        visible ? "h-full min-h-0 flex-1 p-2" : "h-0 shrink-0 overflow-hidden p-0",
      )}
      data-testid={active ? "dock-terminal" : "dock-terminal-inactive"}
      data-terminal-font-size={terminalFontSize}
      data-terminal-color-theme={terminalColorTheme}
      aria-hidden={!visible}
      onMouseDown={() => terminalRef.current?.focus()}
      style={{ backgroundColor: paneBackground }}
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
          <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
          <p className="text-xs">Starting the project shell…</p>
        </div>
      )}
    </div>
  );
}
