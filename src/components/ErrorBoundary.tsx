import { Component, type ErrorInfo, type ReactNode } from "react";
import { Check, Copy, Github, RefreshCw } from "lucide-react";
import { appendAppLog } from "@/lib/tauri";
import { reportCrashToGithub } from "@/lib/crash-report";
import { SpecimenIllustration } from "@/components/SpecimenIllustration";

interface Props {
  children: ReactNode;
  // Optional lightweight fallback for wrapping a single risky subtree (a panel)
  // rather than the whole app. When provided, a caught error renders this
  // instead of the full-screen crash screen, so the rest of the UI survives.
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  copied: boolean;
}

// Without this, any render-time exception unmounts the whole React tree and
// leaves a blank window. This catches it, logs details to `~/.oleafly/app.log`
// (so users can share it), and offers a reload.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = `UI crash: ${error.name}: ${error.message}\n${
      error.stack ?? ""
    }\ncomponentStack:${info.componentStack ?? ""}`;
    // Best-effort; never throw from the error handler itself.
    void appendAppLog(detail).catch(() => {});
  }

  copyStack = async () => {
    const { error } = this.state;
    if (!error) return;
    try {
      await navigator.clipboard.writeText(`${error.name}: ${error.message}`);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    } catch {
      /* ignore */
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    // Scoped boundaries render their own compact fallback and leave the rest of
    // the app mounted.
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        data-testid="error-boundary"
        className="grid h-screen w-screen grid-cols-1 gap-12 overflow-auto bg-black p-10 text-white lg:grid-cols-2 lg:items-center lg:p-16"
      >
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            Fig 0.1 — Runtime Fault
          </p>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">Something went wrong</h1>
          <p className="text-base leading-relaxed text-white/60">
            Oleafly hit an unexpected error and couldn't render this screen. Your
            project files are safe on disk — nothing was lost. Diagnostic details
            were written to the log below.
          </p>

          <div className="overflow-hidden rounded-lg border border-white/15">
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                Stack trace
              </span>
              <button
                type="button"
                onClick={() => void this.copyStack()}
                className="flex items-center gap-1.5 text-xs text-white/60 transition-colors hover:text-white"
              >
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-40 overflow-auto px-4 py-3 text-left font-mono text-xs text-white/80">
              {error.name}: {error.message}
            </pre>
          </div>

          <p className="font-mono text-xs text-white/40">
            Log saved to <span className="text-white/60">~/.oleafly/app.log</span>
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              <RefreshCw className="size-4" />
              Reload Oleafly
            </button>
            <button
              type="button"
              onClick={() => void reportCrashToGithub(`${error.name}: ${error.message}`)}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              <Github className="size-4" />
              Report to GitHub
            </button>
          </div>
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-white/15 bg-white/[0.02] lg:block">
          <div className="flex items-center justify-between border-b border-white/15 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            <span>Specimen Viewer</span>
            <span className="flex items-center gap-1.5 text-red-400">
              <span className="size-1.5 rounded-full bg-red-400" />
              Halted
            </span>
          </div>
          <div className="aspect-square p-6">
            <SpecimenIllustration />
          </div>
        </div>
      </div>
    );
  }
}
