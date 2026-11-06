import "@/lib/polyfills";
import { dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Contained } from "@/components/Contained";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DevContextMenu } from "@/components/layout/DevContextMenu";
import { IndexKeeper } from "@/components/editor/IndexKeeper";
import { ZoteroKeeper } from "@/components/zotero/ZoteroKeeper";
import { ThemeProvider } from "@/lib/theme";
import { IconPackHost } from "@/components/icons/pack-icon";
import { loadStoredColorIconPack } from "@/lib/icon-pack-install";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { appendAppLog } from "@/lib/tauri";
import { loadDisplayHomes } from "@/lib/display-path";
import { logError } from "@/lib/log";
import { installQuitFallback } from "@/lib/quit-flush";
import { reapOrphanAgentRuns } from "@/lib/agent-backend";
import { getSnapshotConfig, getSnapshotPendingOpen, hydrateFromSnapshot } from "@/lib/initial-state";
import { prepareColdOpen } from "@/features/open-folder";
import { initializeDesktopI18n, syncLocaleFromConfig } from "@/i18n/desktop";
import { readCachedPreference } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTypstMigrationStore } from "@/store/typst-migration";
import { useRenameStore } from "@/store/rename";
import { useFileRenameStore } from "@/store/file-rename";
import { useCitationStore } from "@/store/citation";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { useTableImportStore } from "@/store/table-import";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { mountOnFirstOpen } from "@/lib/mount-on-first-open";
import { registerContributions } from "@/contributions";
import { installDesktopViewportGuard } from "@/lib/desktop-viewport";
import { installSelectAllRouting } from "@/lib/select-all";
import { installPlainFieldHistory } from "@/lib/field-history";
import { installExternalDropGuard } from "@/lib/external-drop-guard";
import "@/styles/globals.css";
import { isTauri } from "@tauri-apps/api/core";
import { isMac } from "@/lib/utils";
import { StoredAppTypography } from "@/lib/app-typography";
import { AppZoom } from "@/lib/app-zoom";
import { AppIcon } from "@/lib/app-icon";
import { registerE2EImports } from "@/lib/e2e-import-registry";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { AdminConsoleSlot } from "@/components/collab/CollabSlots";

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

type WindowView = "main" | "update" | "preview" | "present" | "presenter" | "admin";

function currentWindowView(): WindowView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (
    view === "update" ||
    view === "preview" ||
    view === "present" ||
    view === "presenter" ||
    view === "admin"
  ) {
    return view;
  }
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
  if (view === "present" || view === "presenter" || view === "admin") {
    document.documentElement.style.setProperty("--app-surface", "var(--background)");
  }
  dismissBootSplash();
}

const queryClient = appQueryClient();

const UpdateWindow = lazy(() =>
  import("@/components/layout/UpdateWindow").then((module) => ({ default: module.UpdateWindow })),
);
const PreviewWindow = lazy(() =>
  import("@/components/preview/PreviewWindow").then((module) => ({ default: module.PreviewWindow })),
);
const RenameDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/RenameDialog").then((module) => ({ default: module.RenameDialog })),
  ),
  () => useRenameStore((state) => state.sym !== null),
  () => useRenameStore.getState().close(),
);
const FileRenameDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/FileRenameDialog").then((module) => ({ default: module.FileRenameDialog })),
  ),
  () => useFileRenameStore((state) => state.target !== null),
  () => useFileRenameStore.getState().close(),
);
const FileReferencesDialog = lazy(() =>
  import("@/components/files/FileReferencesDialog").then((module) => ({ default: module.FileReferencesDialog })),
);
const AddCitationDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/AddCitationDialog").then((module) => ({ default: module.AddCitationDialog })),
  ),
  () => useCitationStore((state) => state.open),
  () => useCitationStore.getState().setOpen(false),
);
const ZoteroDialogs = mountOnFirstOpen(
  lazy(() =>
    import("@/components/zotero/ZoteroDialogs").then((module) => ({ default: module.ZoteroDialogs })),
  ),
  () =>
    useZoteroDialogStore(
      (state) =>
        state.bulk !== null ||
        state.bibliographyChoice !== null ||
        state.handEdits !== null ||
        state.handList !== null,
    ),
  () => {
    const zotero = useZoteroDialogStore.getState();
    zotero.bibliographyChoice?.resolve(null);
    zotero.handEdits?.resolve(false);
    zotero.handList?.resolve(false);
    zotero.closeBulk();
  },
);
const TableImportDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/TableImportDialog").then((module) => ({ default: module.TableImportDialog })),
  ),
  () => useTableImportStore((state) => state.open),
  () => useTableImportStore.getState().setOpen(false),
);
const FigureDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/FigureDialog").then((module) => ({ default: module.FigureDialog })),
  ),
  () => useFigureDialogStore((state) => state.open),
  () => useFigureDialogStore.getState().setOpen(false),
);
const PresentationWindow = lazy(() =>
  import("@/components/presentation/PresentationWindow").then((module) => ({ default: module.PresentationWindow })),
);
const PresenterWindow = lazy(() =>
  import("@/components/presentation/PresenterWindow").then((module) => ({ default: module.PresenterWindow })),
);
const TypstMigrationDialog = lazy(() =>
  import("@/components/migration/TypstMigrationDialog").then((module) => ({ default: module.TypstMigrationDialog })),
);

function TypstMigrationHost() {
  const open = useTypstMigrationStore((state) => state.open);
  if (!open) return null;
  return (
    <Contained resetKey={open} close={() => useTypstMigrationStore.getState().close()}>
      <Suspense fallback={null}>
        <TypstMigrationDialog />
      </Suspense>
    </Contained>
  );
}
const TypstDocumentPanels = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/TypstDocumentPanels").then((module) => ({ default: module.TypstDocumentPanels })),
  ),
  () => useTypstDocumentPanelStore((state) => state.panel !== null),
  () => useTypstDocumentPanelStore.getState().closePanel(),
);

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

function WindowContent({ view }: Readonly<{ view: WindowView }>) {
  if (view === "update") {
    return (
      <ThemeProvider>
        <StoredAppTypography />
        <AppZoom />
        <Suspense fallback={null}>
          <UpdateWindow />
        </Suspense>
      </ThemeProvider>
    );
  }
  if (view === "preview") {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StoredAppTypography />
          <AppZoom />
          <Suspense fallback={null}>
            <PreviewWindow />
          </Suspense>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
  if (view === "present" || view === "presenter") {
    return (
      <ThemeProvider>
        <StoredAppTypography />
        <AppZoom />
        <Suspense fallback={null}>
          {view === "present" ? <PresentationWindow /> : <PresenterWindow />}
        </Suspense>
      </ThemeProvider>
    );
  }
  if (view === "admin") {
    return (
      <ThemeProvider>
        <StoredAppTypography />
        <AppZoom />
        <AdminConsoleSlot />
      </ThemeProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AppZoom />
      <AppIcon />
      <IconPackHost />
      <App />
      <Contained>
        <Toaster />
      </Contained>
      <ConfirmHost />
      <Contained>
        <DevContextMenu />
      </Contained>
      <Contained>
        <IndexKeeper />
      </Contained>
      <Contained>
        <ZoteroKeeper />
      </Contained>
      <RenameDialog />
      <FileRenameDialog />
      <Contained>
        <Suspense fallback={null}>
          <FileReferencesDialog />
        </Suspense>
      </Contained>
      <AddCitationDialog />
      <ZoteroDialogs />
      <TableImportDialog />
      <FigureDialog />
      <TypstMigrationHost />
      <TypstDocumentPanels />
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
  void loadDisplayHomes();
  if (view === "main") {
    void installQuitFallback().catch((error) => logError("prepare quit fallback", error));
    await Promise.all([reapOrphanAgentRuns(), hydrateFromSnapshot(), initializeDesktopI18n()]);
    await syncLocaleFromConfig(getSnapshotConfig()?.ui_locale);
    useSettingsStore.setState({ uiLocalePreference: readCachedPreference() });
    prepareColdOpen(getSnapshotPendingOpen());
  } else {
    await initializeDesktopI18n();
  }
  registerContributions();
  markBootStage("contributions-registered");
  // The colour icon pack is optional; a missing or stale one leaves the neutral icons.
  void loadStoredColorIconPack();
  await installDevelopmentProbe();
  installErrorLogging();
  installSelectAllRouting();
  installPlainFieldHistory();
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
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void appendAppLog(`Application bootstrap failed: ${message}`).catch(() => {});
});
