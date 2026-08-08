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

void (async () => {
const bootViewParam = new URLSearchParams(window.location.search).get("view");
if (bootViewParam !== "update" && bootViewParam !== "preview") {
  await reapOrphanAgentRuns();
}

// Must run before the shell mounts and reads the registry.
registerContributions();
markBootStage("contributions-registered");
// Awaited, not floating: the e2e devtools hooks used to be installed
// synchronously as side effects of eagerly imported modules, and specs call
// them as soon as the library paints. Resolving this before the app renders
// keeps that guarantee. Production drops the whole branch.
if (import.meta.env.DEV) {
  const { installE2ePdfProbe } = await import("@/lib/e2e-probe");
  installE2ePdfProbe();
}

// Log otherwise-invisible failures so they can be diagnosed from a bug report.
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const msg = reason?.stack || reason?.message || String(reason);
  void appendAppLog(`Unhandled promise rejection: ${msg}`).catch(() => {});
});
window.addEventListener("error", (e) => {
  const msg = e.error?.stack || e.message || String(e.error);
  void appendAppLog(`Uncaught error: ${msg}`).catch(() => {});
});

const viewParam = bootViewParam;
const isUpdateWindow = viewParam === "update";
const isPreviewWindow = viewParam === "preview";

if (!isUpdateWindow && !isPreviewWindow) {
  installDesktopViewportGuard();
}

// The update window is transparent so its rounded card defines the window
// shape; clear the opaque page background the main app sets.
if (isUpdateWindow) {
  for (const el of [document.documentElement, document.body]) {
    el.style.background = "transparent";
  }
}

// Secondary windows never show the splash; drop it before their render.
if (isUpdateWindow || isPreviewWindow) {
  dismissBootSplash();
}

const root = document.getElementById("root");
if (!root) throw new Error("Oleafly root element is missing");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {isUpdateWindow ? (
        <ThemeProvider>
          <UpdateWindow />
        </ThemeProvider>
      ) : isPreviewWindow ? (
        <ThemeProvider>
          <PreviewWindow />
          <Toaster />
        </ThemeProvider>
      ) : (
        <>
          <App />
          <Toaster />
          <DevContextMenu />
          <IndexKeeper />
          <RenameDialog />
          <AddCitationDialog />
        </>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
})().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void appendAppLog(`Application bootstrap failed: ${message}`).catch(() => {});
});
