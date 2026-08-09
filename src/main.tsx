import "@/lib/polyfills"; // must run before pdf.js and other libs load
import { dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { StrictMode } from "react";
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
import { Toaster } from "@/components/ui/sonner";
import { appendAppLog } from "@/lib/tauri";
import { reapOrphanAgentRuns } from "@/lib/agent-backend";
import { registerContributions } from "@/contributions";
import { installDesktopViewportGuard } from "@/lib/desktop-viewport";
import "@/styles/globals.css";

markBootStage("entry-evaluated");

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
  if (!import.meta.env.DEV) return;
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
      <ThemeProvider>
        <PreviewWindow />
        <Toaster />
      </ThemeProvider>
    );
  }
  return (
    <>
      <App />
      <Toaster />
      <DevContextMenu />
      <IndexKeeper />
      <RenameDialog />
      <AddCitationDialog />
    </>
  );
}

async function bootstrap(): Promise<void> {
  const view = currentWindowView();
  if (view === "main") await reapOrphanAgentRuns();
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
