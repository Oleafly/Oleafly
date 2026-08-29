import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTheme } from "@/lib/theme";
import "@xterm/xterm/css/xterm.css";

// Harness terminal: the user's login shell inside the open project directory,
// backed by src-tauri/src/terminal.rs over a pty. The backend refuses any
// working directory that is not a validated project dir.
export function TerminalPane({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [booted, setBooted] = useState(false);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
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
          void invoke("term_kill", { id }).catch(() => {});
          return;
        }
        sessionId = id;
        // Label the tab with the folder the shell started in, so the project
        // scope is visible even before the first prompt renders.
        if (projectName) {
          terminal.write(`\x1b]2;${projectName} — project shell\x07`);
        }
      })
      .catch((error) => {
        terminal.writeln(`\r\nThe shell could not start: ${String(error)}`);
      });

    const dataSub = terminal.onData((data) => {
      if (sessionId) void invoke("term_write", { id: sessionId, data }).catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (sessionId) {
        void invoke("term_resize", {
          id: sessionId,
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
      if (sessionId) void invoke("term_kill", { id: sessionId }).catch(() => {});
      terminal.dispose();
    };
  }, [projectId, projectName]);

  return (
    <div className="relative h-full w-full bg-surface p-2" data-testid="harness-terminal">
      <div ref={hostRef} className="h-full w-full" />
      {!booted && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface text-muted-foreground"
          data-testid="harness-terminal-loading"
        >
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
          <p className="text-xs">Starting the project shell…</p>
        </div>
      )}
    </div>
  );
}
