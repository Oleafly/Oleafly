import "@/lib/polyfills"; // must run before pdf.js and other libs load
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
import { Toaster } from "@/components/ui/toaster";
import { appendAppLog } from "@/lib/tauri";
import { registerContributions } from "@/contributions";
import "@/styles/globals.css";

// Populate the contribution registry (rail tabs, commands, AI toolsets)
// before the shell mounts and reads it.
registerContributions();

// Record otherwise-invisible failures (rejected promises, non-React errors) to
// the shared app log so they can be diagnosed from a user's bug report.
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const msg = reason?.stack || reason?.message || String(reason);
  void appendAppLog(`Unhandled promise rejection: ${msg}`).catch(() => {});
});
window.addEventListener("error", (e) => {
  const msg = e.error?.stack || e.message || String(e.error);
  void appendAppLog(`Uncaught error: ${msg}`).catch(() => {});
});

// Dedicated secondary windows render a slice of the SPA via `?view=…` in their
// own JS context (same pattern as preview / update).
const viewParam = new URLSearchParams(window.location.search).get("view");
const isUpdateWindow = viewParam === "update";
const isPreviewWindow = viewParam === "preview";

// The update window is transparent so its rounded card defines the window
// shape; clear the opaque page background the main app sets.
if (isUpdateWindow) {
  for (const el of [document.documentElement, document.body]) {
    el.style.background = "transparent";
  }
}

createRoot(document.getElementById("root")!).render(
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
  </StrictMode>
);
