import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "@/lib/theme";
import "@xterm/xterm/css/xterm.css";

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
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (visible && activatedProjectId !== projectId) setActivatedProjectId(projectId);
  }, [activatedProjectId, projectId, visible]);

  useEffect(() => {
    if (activatedProjectId !== projectId) return;
    const host = hostRef.current;
    if (!host) return;
    setBooted(false);
    const dark = themeRef.current === "dark";
    const terminal = new Terminal({
      fontSize: 12,
      fontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      cursorBlink: true,
      theme: dark
        ? { background: "#181818", foreground: "#dfdfdf", cursor: "#dfdfdf" }
        : { background: "#ffffff", foreground: "#1a1c1f", cursor: "#1a1c1f" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
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
      })
      .catch((error) => {
        terminal.writeln(`\r\nThe shell could not start: ${String(error)}`);
      });

    const dataSub = terminal.onData((data) => {
      if (sessionId) {
        void invoke("term_write", { id: sessionId, projectId, data }).catch(() => {});
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
        }).catch(() => {});
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
    if (!projectName || activatedProjectId !== projectId) return;
    terminalRef.current?.write(`\x1b]2;${projectName} - project shell\x07`);
  }, [activatedProjectId, projectId, projectName]);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      fitRef.current?.fit();
      const id = sessionIdRef.current;
      if (terminal && id) {
        void invoke("term_resize", {
          id,
          projectId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => {});
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectId, visible]);

  return (
    <div
      className="relative h-full w-full bg-background p-2"
      data-testid="dock-terminal"
      aria-hidden={!visible}
    >
      <div ref={hostRef} className="h-full w-full" />
      {!booted && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
          data-testid="dock-terminal-loading"
        >
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
          <p className="text-xs">Starting the project shell…</p>
        </div>
      )}
    </div>
  );
}
