import { useEffect, useRef, useState } from "react";
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

export function TerminalPane({
  projectId,
  projectName,
  visible = true,
}: {
  projectId: string;
  projectName?: string;
  visible?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionLiveRef = useRef(false);
  const surfacedErrorsRef = useRef(new Set<string>());
  const outputWrittenRef = useRef<(() => void) | undefined>(undefined);
  const visibleRef = useRef(visible);
  const previousVisibleRef = useRef(visible);
  visibleRef.current = visible;
  const [booted, setBooted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [activatedProjectId, setActivatedProjectId] = useState<string | null>(
    visible ? projectId : null,
  );
  const setTerminalOpen = useSettingsStore((state) => state.setTerminalOpen);
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
    const becameVisible = visible && !previousVisibleRef.current;
    previousVisibleRef.current = visible;
    if (
      visible &&
      activatedProjectId !== projectId &&
      (!sessionEnded || becameVisible)
    ) {
      setActivatedProjectId(projectId);
    }
    if (becameVisible && sessionEnded) setSessionEnded(false);
  }, [activatedProjectId, projectId, sessionEnded, visible]);

  useEffect(() => {
    if (activatedProjectId !== projectId || sessionEnded) return;
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
    fit.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitRef.current = fit;

    let sessionId: string | null = null;
    let sessionLive = false;
    let sessionExited = false;
    let disposed = false;
    const channel = new Channel<TerminalChannelMessage>();
    channel.onmessage = (message) => {
      if (E2E_HOOKS) {
        const w = window as typeof window & { __e2eTerminalEvents?: string[] };
        w.__e2eTerminalEvents = w.__e2eTerminalEvents ?? [];
        w.__e2eTerminalEvents.push(
          message.event === "output"
            ? "output"
            : `exit(disposed=${disposed},exited=${sessionExited})`,
        );
      }
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
      setSessionEnded(true);
      setTerminalOpen(false);
    };
    void invoke<string>("term_open", {
      projectId,
      cols: terminal.cols,
      rows: terminal.rows,
      channel,
    })
      .then((id) => {
        if (disposed || sessionExited) {
          void invoke("term_kill", { id, projectId }).catch(() => {});
          return;
        }
        sessionId = id;
        sessionIdRef.current = id;
        sessionLive = true;
        sessionLiveRef.current = true;
        setBooted(true);
        if (visibleRef.current) terminal.focus();
      })
      .catch((error) => {
        if (disposed || sessionExited) return;
        setBooted(true);
        writeTerminalError(terminal, "The shell could not start", error, outputWritten);
      });

    const dataSub = terminal.onData((data) => {
      if (sessionLive && sessionId) {
        void invoke("term_write", { id: sessionId, projectId, data }).catch((error) => {
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
      }
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
      sessionLive = false;
      sessionLiveRef.current = false;
      observer.disconnect();
      dataSub.dispose();
      if (sessionId) void invoke("term_kill", { id: sessionId, projectId }).catch(() => {});
      sessionIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      if (outputWrittenRef.current === outputWritten) outputWrittenRef.current = undefined;
      terminal.dispose();
    };
  }, [activatedProjectId, projectId, sessionEnded, setTerminalOpen]);

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
    fitRef.current?.fit();
    const id = sessionIdRef.current;
    if (id && sessionLiveRef.current && visibleRef.current) {
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
    if (!projectName || activatedProjectId !== projectId) return;
    terminalRef.current?.write(`\x1b]2;${projectName} - project shell\x07`);
  }, [activatedProjectId, projectId, projectName]);

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
      className="relative h-full w-full p-2"
      data-testid="dock-terminal"
      data-terminal-font-size={terminalFontSize}
      data-terminal-color-theme={terminalColorTheme}
      aria-hidden={!visible}
      onMouseDown={() => terminalRef.current?.focus()}
      style={{ backgroundColor: terminalBackground }}
    >
      <div ref={hostRef} className="h-full w-full" data-testid="dock-terminal-host" />
      {!booted && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"
          data-testid="dock-terminal-loading"
          style={{ backgroundColor: terminalBackground }}
        >
          <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
          <p className="text-xs">Starting the project shell…</p>
        </div>
      )}
    </div>
  );
}
