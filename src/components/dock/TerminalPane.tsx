import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Loader2 } from "lucide-react";
import { TERMINAL_COLOR_THEMES, useSettingsStore } from "@/store/settings";
import "@xterm/xterm/css/xterm.css";

function writeTerminalError(terminal: Terminal, message: string, error: unknown) {
  terminal.writeln(`\r\n${message}: ${String(error)}`);
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
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [booted, setBooted] = useState(false);
  const [activatedProjectId, setActivatedProjectId] = useState<string | null>(
    visible ? projectId : null,
  );
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
    if (visible && activatedProjectId !== projectId) setActivatedProjectId(projectId);
  }, [activatedProjectId, projectId, visible]);

  useEffect(() => {
    if (activatedProjectId !== projectId) return;
    const host = hostRef.current;
    if (!host) return;
    setBooted(false);
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
    fit.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitRef.current = fit;

    let sessionId: string | null = null;
    let disposed = false;
    const channel = new Channel<string>();
    channel.onmessage = (data) => {
      if (disposed) return;
      setBooted(true);
      terminal.write(data);
    };
    void invoke<string>("term_open", {
      projectId,
      cols: terminal.cols,
      rows: terminal.rows,
      channel,
    })
      .then((id) => {
        if (disposed) {
          void invoke("term_kill", { id, projectId }).catch(() => {});
          return;
        }
        sessionId = id;
        sessionIdRef.current = id;
        setBooted(true);
        if (visibleRef.current) terminal.focus();
      })
      .catch((error) => {
        if (disposed) return;
        setBooted(true);
        writeTerminalError(terminal, "The shell could not start", error);
      });

    const dataSub = terminal.onData((data) => {
      if (sessionId) {
        void invoke("term_write", { id: sessionId, projectId, data }).catch((error) => {
          if (!disposed) {
            writeTerminalError(terminal, "The shell could not accept input", error);
          }
        });
      }
    });
    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      fit.fit();
      if (sessionId) {
        void invoke("term_resize", {
          id: sessionId,
          projectId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch((error) => {
          if (!disposed) writeTerminalError(terminal, "The terminal could not resize", error);
        });
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      if (sessionId) void invoke("term_kill", { id: sessionId, projectId }).catch(() => {});
      sessionIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [activatedProjectId, projectId]);

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
    if (id && visibleRef.current) {
      void invoke("term_resize", {
        id,
        projectId,
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch((error) => {
        writeTerminalError(terminal, "The terminal could not resize", error);
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
      if (terminal && id) {
        void invoke("term_resize", {
          id,
          projectId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch((error) => {
          writeTerminalError(terminal, "The terminal could not resize", error);
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectId, visible]);

  return (
    <div
      className="relative h-full w-full p-2"
      data-testid="dock-terminal"
      aria-hidden={!visible}
      onMouseDown={() => terminalRef.current?.focus()}
      style={{ backgroundColor: terminalBackground }}
    >
      <div ref={hostRef} className="h-full w-full" />
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
