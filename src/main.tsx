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

// Must run before the shell mounts and reads the registry.
registerContributions();
if (import.meta.env.DEV) {
  void import("@/lib/e2e-probe").then(({ installE2ePdfProbe }) => installE2ePdfProbe());
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

const root = document.getElementById("root");
if (!root) throw new Error("OpenLeaf root element is missing");

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
