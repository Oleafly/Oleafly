import { Component, type ErrorInfo, type ReactNode } from "react";
import { appendAppLog } from "@/lib/tauri";
import { reportCrashToGithub } from "@/lib/crash-report";

interface Props {
  children: ReactNode;
  // Optional lightweight fallback for wrapping a single risky subtree (a panel)
  // rather than the whole app. When provided, a caught error renders this
  // instead of the full-screen crash screen, so the rest of the UI survives.
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any render-time exception unmounts the whole React tree and
// leaves a blank window. This catches it, logs details to `~/.openleaf/app.log`
// (so users can share it), and offers a reload.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = `UI crash: ${error.name}: ${error.message}\n${
      error.stack ?? ""
    }\ncomponentStack:${info.componentStack ?? ""}`;
    // Best-effort; never throw from the error handler itself.
    void appendAppLog(detail).catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Scoped boundaries render their own compact fallback and leave the rest of
    // the app mounted.
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div data-testid="error-boundary" className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            OpenLeaf hit an unexpected error and couldn't render this screen. Your
            files are safe on disk. Details were saved to{" "}
            <code className="rounded bg-foreground/10 px-1 py-0.5 text-xs">
              ~/.openleaf/app.log
            </code>
            .
          </p>
        </div>
        <pre className="max-h-40 max-w-lg overflow-auto rounded-md border bg-muted/40 p-3 text-left font-mono text-[11px] text-muted-foreground">
          {error.name}: {error.message}
        </pre>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => void reportCrashToGithub(`${error.name}: ${error.message}`)}
            className="rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Report to GitHub
          </button>
          <button type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Reload OpenLeaf
          </button>
        </div>
      </div>
    );
  }
}
