import { Suspense } from "react";
import { lazy } from "@/lib/preloadable";
import App from "./App";
import { Contained } from "@/components/Contained";
import { DevContextMenu } from "@/components/layout/DevContextMenu";
import { IndexKeeper } from "@/components/editor/IndexKeeper";
import { ZoteroKeeper } from "@/components/zotero/ZoteroKeeper";
import { ThemeProvider } from "@/lib/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { loadNamespace } from "@/i18n";
import { useTypstMigrationStore } from "@/store/typst-migration";
import { useRenameStore } from "@/store/rename";
import { useFileRenameStore } from "@/store/file-rename";
import { useCitationStore } from "@/store/citation";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { useTableImportStore } from "@/store/table-import";
import { useChapterImportStore } from "@/store/chapter-import";
import { useStyleRuleDialogStore } from "@/store/style-rule-dialog";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useSaveSnippetDialog } from "@/features/snippets/save-dialog";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { OpeningIndicator } from "@/components/ui/opening-indicator";
import { mountOnFirstOpen } from "@/lib/mount-on-first-open";
import { StoredAppTypography } from "@/lib/app-typography";
import { AppZoom } from "@/lib/app-zoom";
import { AppIcon } from "@/lib/app-icon";
import { AdminConsoleSlot } from "@/components/collab/CollabSlots";

export type WindowView = "main" | "update" | "preview" | "present" | "presenter" | "admin" | "capture";

const queryClient = appQueryClient();

const UpdateWindow = lazy(() =>
  import("@/components/layout/UpdateWindow").then((module) => ({ default: module.UpdateWindow })),
);
const QuickCaptureWindow = lazy(() =>
  Promise.all([import("@/components/notes/QuickCaptureWindow"), loadNamespace("notes"), loadNamespace("editor")]).then(([module]) => ({
    default: module.QuickCaptureWindow,
  })),
);
const PreviewWindow = lazy(() =>
  import("@/components/preview/PreviewWindow").then((module) => ({ default: module.PreviewWindow })),
);
const RenameDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/RenameDialog").then((module) => ({ default: module.RenameDialog })), { warm: true }),
  () => useRenameStore((state) => state.sym !== null),
  () => useRenameStore.getState().close(),
  { loading: <OpeningIndicator /> },
);
const FileRenameDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/FileRenameDialog").then((module) => ({ default: module.FileRenameDialog })), { warm: true }),
  () => useFileRenameStore((state) => state.target !== null),
  () => useFileRenameStore.getState().close(),
  { loading: <OpeningIndicator /> },
);
const FileReferencesDialog = lazy(() =>
  import("@/components/files/FileReferencesDialog").then((module) => ({ default: module.FileReferencesDialog })), { warm: true });
const AddCitationDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/layout/AddCitationDialog").then((module) => ({ default: module.AddCitationDialog })), { warm: true }),
  () => useCitationStore((state) => state.open),
  () => useCitationStore.getState().setOpen(false),
  { loading: <OpeningIndicator /> },
);
const ZoteroDialogs = mountOnFirstOpen(
  lazy(() =>
    import("@/components/zotero/ZoteroDialogs").then((module) => ({ default: module.ZoteroDialogs })), { warm: true }),
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
  { loading: <OpeningIndicator /> },
);
const TableImportDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/TableImportDialog").then((module) => ({ default: module.TableImportDialog })), { warm: true }),
  () => useTableImportStore((state) => state.open),
  () => useTableImportStore.getState().setOpen(false),
  { loading: <OpeningIndicator /> },
);
const ChapterImportDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/ChapterImportDialog").then((module) => ({ default: module.ChapterImportDialog })), { warm: true }),
  () => useChapterImportStore((state) => state.open),
  () => useChapterImportStore.getState().setOpen(false),
  { loading: <OpeningIndicator /> },
);
const StyleRuleDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/preflight/StyleRuleDialog").then((module) => ({ default: module.StyleRuleDialog }))),
  () => useStyleRuleDialogStore((state) => state.open),
  () => useStyleRuleDialogStore.getState().setOpen(false),
  { loading: <OpeningIndicator /> },
);
const FigureDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/FigureDialog").then((module) => ({ default: module.FigureDialog })), { warm: true }),
  () => useFigureDialogStore((state) => state.open),
  () => useFigureDialogStore.getState().setOpen(false),
  { loading: <OpeningIndicator /> },
);
const SaveSnippetDialog = mountOnFirstOpen(
  lazy(() =>
    import("@/features/snippets/SaveSnippetDialog").then((module) => ({ default: module.SaveSnippetDialog }))),
  () => useSaveSnippetDialog((state) => state.selection !== null),
  () => useSaveSnippetDialog.getState().close(),
  { loading: <OpeningIndicator /> },
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

export function WindowContent({ view }: Readonly<{ view: WindowView }>) {
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
  if (view === "capture") {
    return (
      <ThemeProvider>
        <StoredAppTypography />
        <AppZoom />
        <Suspense fallback={null}>
          <QuickCaptureWindow />
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
      <ChapterImportDialog />
      <StyleRuleDialog />
      <FigureDialog />
      <SaveSnippetDialog />
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
