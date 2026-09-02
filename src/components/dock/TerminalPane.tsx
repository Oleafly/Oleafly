import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Loader2 } from "lucide-react";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { TERMINAL_COLOR_THEMES, useSettingsStore } from "@/store/settings";
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
    const theme = {
      ...TERMINAL_COLOR_THEMES[appearance.terminalColorTheme].colors,
      background: appearance.terminalBackground,
      foreground: appearance.terminalForeground,
      cursor: appearance.terminalCursorColor,
    };
    const terminal = new Terminal({
      fontSize: appearance.terminalFontSize,
      fontFamily: appearance.terminalFontFamily,
      fontWeight: appearance.terminalFontWeight,
      fontWeightBold: appearance.terminalFontWeightBold,
      cursorStyle: appearance.terminalCursorStyle,
      cursorBlink: appearance.terminalCursorBlink,
      drawBoldTextInBrightColors: true,
      theme,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const outputTarget = host.parentElement;
    const outputWritten = terminalOutputCallback(terminal, outputTarget);
    outputWrittenRef.current = outputWritten;
    if (outputWritten && outputTarget) outputTarget.dataset.terminalOutput = "";
    if (visibleRef.current) {
      fit.fit();
      terminal.focus();
    } else if (host.clientWidth > 0) {
      const proposed = fit.proposeDimensions();
      if (proposed) terminal.resize(proposed.cols, terminal.rows);
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
        if (E2E_HOOKS) {
          terminal.write(message.data, outputWritten);
        } else {
          terminal.write(message.data);
        }
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
      if (!visibleRef.current) return;
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
      observer.disconnect();
      dataSub.dispose();
      if (sessionId) void invoke("term_kill", { id: sessionId, projectId }).catch(() => {});
      sessionIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      if (outputWrittenRef.current === outputWritten) outputWrittenRef.current = undefined;
      terminal.dispose();
    };
  }, [activated, ended, projectId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = terminalFontSize;
    terminal.options.fontFamily = terminalFontFamily;
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = terminalFontWeightBold;
    terminal.options.cursorStyle = terminalCursorStyle;
    terminal.options.cursorBlink = terminalCursorBlink;
    terminal.options.drawBoldTextInBrightColors = true;
    terminal.options.theme = {
      ...TERMINAL_COLOR_THEMES[terminalColorTheme].colors,
      background: terminalBackground,
      foreground: terminalForeground,
      cursor: terminalCursorColor,
    };
    if (!visibleRef.current) return;
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
      style={{ backgroundColor: terminalBackground }}
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
          style={{ backgroundColor: terminalBackground }}
        >
          <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
          <p className="text-xs">Starting the project shell…</p>
        </div>
      )}
    </div>
  );
}
