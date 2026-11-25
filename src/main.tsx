import "@/lib/polyfills";
import { dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WindowContent, type WindowView } from "./WindowContent";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadDisplayHomes } from "@/lib/display-path";
import { installErrorLogging, logError } from "@/lib/log";
import { installQuitFallback } from "@/lib/quit-flush";
import { getSnapshotConfig, getSnapshotPendingOpen, hydrateFromSnapshot } from "@/lib/initial-state";
import { prepareColdOpen } from "@/features/open-folder";
import { initializeDesktopI18n, syncLocaleFromConfig } from "@/i18n/desktop";
import { readCachedPreference } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { registerContributions } from "@/contributions";
import { installDesktopViewportGuard } from "@/lib/desktop-viewport";
import { installSelectAllRouting } from "@/lib/select-all";
import { installPlainFieldHistory } from "@/lib/field-history";
import { installFunctionKeyTextGuard } from "@/lib/function-key-text";
import { installExternalDropGuard } from "@/lib/external-drop-guard";
import "@/styles/globals.css";
import { isTauri } from "@tauri-apps/api/core";
import { isMac } from "@/lib/utils";
import { registerE2EImports } from "@/lib/e2e-import-registry";
import { E2E_HOOKS } from "@/lib/e2e-flags";

markBootStage("entry-evaluated");

// Vibrancy blur exists only on macOS and Windows. Anywhere else (Linux, a
// plain browser tab) the translucent app surface would sit over the desktop
// or the page background with no blur, so paint it solid instead.
const vibrancyCapable =
  isTauri() && (isMac || navigator.userAgent.includes("Windows"));
if (!vibrancyCapable) {
  document.documentElement.style.setProperty("--app-surface", "var(--background)");
}

if ((window as { __OLEAFLY_E2E_BOOT__?: boolean }).__OLEAFLY_E2E_BOOT__) {
  registerE2EImports();
}

function currentWindowView(): WindowView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (
    view === "update" ||
    view === "preview" ||
    view === "present" ||
    view === "presenter" ||
    view === "admin" ||
    view === "capture"
  ) {
    return view;
  }
  return "main";
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
  if (view === "present" || view === "presenter" || view === "admin") {
    document.documentElement.style.setProperty("--app-surface", "var(--background)");
  }
  dismissBootSplash();
}

async function bootstrap(): Promise<void> {
  const view = currentWindowView();
  void loadDisplayHomes();
  if (view === "main") {
    void installQuitFallback().catch((error) => logError("prepare quit fallback", error));
    await Promise.all([hydrateFromSnapshot(), initializeDesktopI18n()]);
    await syncLocaleFromConfig(getSnapshotConfig()?.ui_locale);
    useSettingsStore.setState({ uiLocalePreference: readCachedPreference() });
    prepareColdOpen(getSnapshotPendingOpen());
  } else {
    await initializeDesktopI18n();
  }
  registerContributions();
  markBootStage("contributions-registered");
  await installDevelopmentProbe();
  installErrorLogging();
  installSelectAllRouting();
  installPlainFieldHistory();
  installFunctionKeyTextGuard();
  installExternalDropGuard();
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
  void logError("Application bootstrap failed", error);
});
