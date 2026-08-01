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
import { Toaster } from "@/components/ui/sonner";
import { appendAppLog } from "@/lib/tauri";
import { registerContributions } from "@/contributions";
import { installDesktopViewportGuard } from "@/lib/desktop-viewport";
import { getInitializationError, initializationFailureMessage, initializeI18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import "@/styles/globals.css";

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

async function bootstrap() {
  await initializeI18n(useSettingsStore.getState().uiLocalePreference);
  const initError = getInitializationError();
  if (initError !== null) {
    void appendAppLog(`Localization init fell back to English: ${describeError(initError)}`).catch(
      () => {},
    );
    toast.error(initializationFailureMessage());
  }

  // Must run after localization is ready and before the shell reads the registry.
  registerContributions();
  if (import.meta.env.DEV) {
    void import("@/lib/e2e-probe").then(({ installE2ePdfProbe }) => installE2ePdfProbe());
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
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// The app must never present a blank window: if bootstrap fails past the
// point of recovery, replace the splash with a plain-DOM report.
function renderBootstrapFailure(message: string): void {
  const host = document.getElementById("root") ?? document.body;
  host.replaceChildren();
  const panel = document.createElement("div");
  panel.setAttribute(
    "style",
    "max-width:640px;margin:15vh auto 0;padding:24px;font-family:system-ui,sans-serif;color:#e5e7eb;",
  );
  const title = document.createElement("h1");
  title.textContent = "Oleafly failed to start";
  title.setAttribute("style", "font-size:18px;margin:0 0 8px;");
  const hint = document.createElement("p");
  hint.textContent =
    "Restart the app to try again. If this keeps happening, please report the details below.";
  hint.setAttribute("style", "font-size:13px;margin:0 0 16px;color:#9ca3af;");
  const detail = document.createElement("pre");
  detail.textContent = message;
  detail.setAttribute(
    "style",
    "font-size:11px;white-space:pre-wrap;word-break:break-word;background:#1f2937;padding:12px;border-radius:8px;max-height:40vh;overflow:auto;",
  );
  panel.append(title, hint, detail);
  host.append(panel);
}

void bootstrap().catch((error) => {
  const message = describeError(error);
  void appendAppLog(`Localization bootstrap failed: ${message}`).catch(() => {});
  renderBootstrapFailure(message);
});
