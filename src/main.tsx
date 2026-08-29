import "@/lib/polyfills"; // must run before pdf.js and other libs load
import { dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DevContextMenu } from "@/components/layout/DevContextMenu";
import { IndexKeeper } from "@/components/editor/IndexKeeper";
import { RenameDialog } from "@/components/layout/RenameDialog";
import { AddCitationDialog } from "@/components/layout/AddCitationDialog";
import { UpdateWindow } from "@/components/layout/UpdateWindow";
import { PreviewWindow } from "@/components/preview/PreviewWindow";
import { ThemeProvider } from "@/lib/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { appendAppLog } from "@/lib/tauri";
import { reapOrphanAgentRuns } from "@/lib/agent-backend";
import { hydrateFromSnapshot } from "@/lib/initial-state";
import { registerContributions } from "@/contributions";
import { installDesktopViewportGuard } from "@/lib/desktop-viewport";
import "@/styles/globals.css";
import { registerE2EImports } from "@/lib/e2e-import-registry";
import { E2E_HOOKS } from "@/lib/e2e-flags";

markBootStage("entry-evaluated");

// Packaged e2e boots (init script in src-tauri/src/lib.rs) need app modules
// resolvable by dev-server path; a normal launch never sets the flag.
if ((window as { __OLEAFLY_E2E_BOOT__?: boolean }).__OLEAFLY_E2E_BOOT__) {
  registerE2EImports();
}

type WindowView = "main" | "update" | "preview";

function currentWindowView(): WindowView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "update" || view === "preview") return view;
  return "main";
}

function installErrorLogging(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason?.stack || reason?.message || String(reason);
    void appendAppLog(`Unhandled promise rejection: ${message}`).catch(() => {});
  });
  window.addEventListener("error", (event) => {
    const message = event.error?.stack || event.message || String(event.error);
    void appendAppLog(`Uncaught error: ${message}`).catch(() => {});
  });
}

async function installDevelopmentProbe(): Promise<void> {
  if (!E2E_HOOKS) return;
  const { installE2ePdfProbe } = await import("@/lib/e2e-probe");
  installE2ePdfProbe();
}

function prepareWindow(view: WindowView): void {
  if (view === "main") {
    installDesktopViewportGuard();
    return;
  }
  if (view === "update") {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }
  dismissBootSplash();
}

// One client per window: server-state queries share a cache for the lifetime
// of the webview.
const queryClient = appQueryClient();

// Dev builds only; the conditional import keeps devtools out of the bundle.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

function WindowContent({ view }: { view: WindowView }) {
  if (view === "update") {
    return (
      <ThemeProvider>
        <UpdateWindow />
      </ThemeProvider>
    );
  }
  if (view === "preview") {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PreviewWindow />
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
      <DevContextMenu />
      <IndexKeeper />
      <RenameDialog />
      <AddCitationDialog />
      {ReactQueryDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

async function bootstrap(): Promise<void> {
  const view = currentWindowView();
  if (view === "main") {
    await Promise.all([reapOrphanAgentRuns(), hydrateFromSnapshot()]);
  }
  registerContributions();
  markBootStage("contributions-registered");
  await installDevelopmentProbe();
  installErrorLogging();
  prepareWindow(view);
  const root = document.getElementById("root");
  if (!root) throw new Error("Oleafly root element is missing");
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <WindowContent view={view} />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void appendAppLog(`Application bootstrap failed: ${message}`).catch(() => {});
});
