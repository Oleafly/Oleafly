import { type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import { Group, Panel, Separator, type GroupImperativeHandle, type Layout } from "react-resizable-panels";
import { registerEditorMutationOwner } from "@/lib/editor-mutation-lease";
import { FileText, Settings2 } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorContextMenu } from "./EditorContextMenu";
import { EditorToolbar, WysiwygModeSwitch } from "./EditorToolbar";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { present } from "@/features/presentation/launch";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { TypstToolbar } from "./TypstToolbar";
import { SelectionActionMenu } from "./SelectionActionMenu";
import { DiffView } from "./diff/DiffView";
import { SidebarCollapseToggle } from "@/components/layout/WorkspaceControls";
import { PANE_BAR_CLASS, usePaneBar } from "@/components/layout/pane-reorder";
import { Tooltip } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getEditorView, wrapSelection } from "./cm/controller";
import { editorKeyTaken, runMarkdownFormatting } from "./markdown-keymap";
import { useFilesStore } from "@/store/files";
import { isManagedProjectPath, isReadOnlyLink } from "@/lib/project-paths";
import { inWidgetControl } from "@/lib/field-history";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner";
import { NoteMarkdownBanner } from "./NoteMarkdownBanner";
import { EditorTabStrip } from "./EditorTabStrip";
import { useDiffStore, diffKey } from "@/store/diff";
import { useSettingsStore } from "@/store/settings";
import { activeNoteTab, editsAsMarkdown, useNoteTabsStore } from "@/store/note-tabs";
import { isEditorNoteFile } from "@/lib/project-notes";
import { fileNoteView, type NoteTabView, personalNoteView, useKeptNoteTabs } from "./kept-note-tabs";
import { loadNamespace } from "@/i18n";
import { useZenStore } from "@/store/zen";
import { isImagePath } from "@/lib/image-mime";
import { basename } from "@/lib/path-utils";
import { cn, isMac } from "@/lib/utils";
import { CollabRemovedFileSlot } from "@/components/collab/CollabSlots";
import {
  type FormattingProfile,
  formattingForPath,
  formattingProfileForPath,
  pathUsesEngineSource,
} from "@/lib/document-engine";
import { fileMode, setActiveFileMode, useFileMode, useVisualModeStore } from "@/store/visual-mode";
import {
  type EditorMode,
  getMarkdownSplitSize,
  isMarkdownPath,
  type MarkdownSplitLayout,
  setMarkdownSplitSize,
  sourcePreviewKind,
} from "@/lib/wysiwyg-mode";
import {
  PANEL_STYLE,
  panelLimitProps,
  percent,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  type PanelLimits,
} from "@/lib/panel-layout";
import { flushWysiwygPendingEdits, setWysiwygVisibilityController } from "./wysiwyg/controller";
import { ProofreadingNotifications } from "./ProofreadingNotifications";
import { LoadingState } from "@/components/ui/empty";
const WysiwygEditor = lazy(() =>
  import("./wysiwyg/WysiwygEditor").then((m) => ({ default: m.WysiwygEditor })));
const MarkdownPreview = lazy(() => import("./MarkdownPreview").then((module) => ({ default: module.MarkdownPreview })));
const noteTabView = () =>
  import("@/components/notes/NoteTabView").then(async (module) => {
    await loadNamespace("notes");
    return module;
  });
const ProjectNoteTab = lazy(() => noteTabView().then((module) => ({ default: module.ProjectNoteTab })));
const PersonalNoteTab = lazy(() => noteTabView().then((module) => ({ default: module.PersonalNoteTab })));
const MARKDOWN_SOURCE_PANEL = "markdown-source-pane";
const MARKDOWN_PREVIEW_PANEL = "markdown-preview-pane";
const MARKDOWN_PANE_LIMITS: PanelLimits = { minSize: 20 };
const MARKDOWN_SPLIT_LIMITS = {
  [MARKDOWN_SOURCE_PANEL]: MARKDOWN_PANE_LIMITS,
  [MARKDOWN_PREVIEW_PANEL]: MARKDOWN_PANE_LIMITS,
};
const FORMATTING_SHORTCUTS: ReadonlyMap<string, "bold" | "italic"> = new Map([
  ["b", "bold"],
  ["i", "italic"],
]);

const DiagramMainFileView = lazy(() => import("./DiagramMainFileView"));
const EditorOutlineRail = lazy(
  () => import("./EditorOutlineRail").then((module) => ({ default: module.EditorOutlineRail })),
  { warm: true },
);
const BoardFileView = lazy(() => import("./board/BoardFileView").then((module) => ({ default: module.BoardFileView })));
const PdfFileView = lazy(() => import("./PdfFileView").then((module) => ({ default: module.PdfFileView })));
const ImageFileView = lazy(() => import("./ImageFileView").then((module) => ({ default: module.ImageFileView })));
const HtmlFilePreview = lazy(() => import("./HtmlFilePreview").then((module) => ({ default: module.HtmlFilePreview })));
const BibReferenceList = lazy(() => import("./BibReferenceList").then((module) => ({ default: module.BibReferenceList })));

function keepEditorFocus(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.classList.contains("cm-scroller")) return;
  event.preventDefault();
  getEditorView()?.focus();
}

function appearanceTabFor(visual: boolean, markdownFile: boolean, profile: FormattingProfile): "visual" | "editor" {
  return visual && (markdownFile || profile === "latex" || profile === "typst") ? "visual" : "editor";
}

function openFileKind(activePath: string | null) {
  return {
    isPdfFile: activePath?.toLowerCase().endsWith(".pdf"),
    isImageFile: activePath != null && isImagePath(activePath),
    isWorkbookFile: activePath != null && /\.(?:xlsx|xls|ods)$/iu.test(activePath),
    isBoardFile: activePath != null && /\.excalidraw$/iu.test(activePath),
    isOpaqueFile:
      activePath != null &&
      /\.(zip|gz|eps|ttf|otf|woff2?)$/i.test(activePath),
  };
}

const DeckView = lazy(() =>
  Promise.all([loadNamespace("notes"), import("./deck/DeckView")]).then(([, module]) => ({
    default: module.DeckView,
  })),
);

const SheetFilePreview = lazy(() =>
  Promise.all([loadNamespace("notes"), import("./SheetFilePreview")]).then(([, module]) => ({
    default: module.SheetFilePreview,
  })),
);

function shownNoteView({
  projectId,
  activePath,
  noteTab,
  noteFile,
  diffFocused,
}: Readonly<{
  projectId: string | null;
  activePath: string | null;
  noteTab: string | null;
  noteFile: boolean;
  diffFocused: boolean;
}>): NoteTabView | null {
  if (!projectId) return null;
  if (noteTab) return personalNoteView(projectId, noteTab);
  if (!diffFocused && noteFile && activePath) return fileNoteView(projectId, activePath);
  return null;
}

export function Editor() {
  const { t } = useTranslation(["common", "editor"]);
  const zen = useZenStore((s) => s.active);
  const paneBar = usePaneBar();
  const interactionRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = interactionRoot.current;
    if (!zen || !root) return;
    root.addEventListener("mousedown", keepEditorFocus);
    return () => root.removeEventListener("mousedown", keepEditorFocus);
  }, [zen]);
  useLayoutEffect(() => registerEditorMutationOwner({
    projectId: () => useFilesStore.getState().projectId,
    setLocked: (locked) => {
      const element = interactionRoot.current;
      if (!element) return;
      element.inert = locked;
      if (locked) element.setAttribute("aria-busy", "true");
      else element.removeAttribute("aria-busy");
    },
  }), []);
  const activePath = useFilesStore((s) => s.activePath);
  const manifestHome = useFilesStore((s) => s.manifestHome);
  const managedFile = !!activePath && isManagedProjectPath(activePath, manifestHome);
  const linkedFile = useFilesStore(
    (s) => !!s.activePath && isReadOnlyLink(s.activePath, s.tree),
  );
  const diffs = useDiffStore((s) => s.diffs);
  const activeKey = useDiffStore((s) => s.activeKey);
  const diffFocused = activeKey !== null && diffs.some((d) => diffKey(d) === activeKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.shiftKey || !(isMac ? e.metaKey : e.ctrlKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest(".cm-editor")) return;
      if (inWidgetControl(el)) return;
      const { activePath: path, engine, engineLoaded } = useFilesStore.getState();
      const key = e.key.toLowerCase();
      const action = FORMATTING_SHORTCUTS.get(key);
      if (!action) return;
      const f = formattingForPath(engine, engineLoaded, path, action);
      if (f?.kind !== "wrap") return;
      const markdown = formattingProfileForPath(engine, engineLoaded, path) === "markdown";
      if (e.defaultPrevented && (markdown || key !== "i" || editorKeyTaken("Mod-i"))) return;
      e.preventDefault();
      if (markdown) runMarkdownFormatting(getEditorView(), action);
      else wrapSelection(f.before, f.after);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasOpenFile = activePath !== null;
  const { isPdfFile, isImageFile, isWorkbookFile, isBoardFile, isOpaqueFile } = openFileKind(activePath);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const isDiagramMainFile = projectKind === "diagram" && activePath === mainDoc;
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const engine = useFilesStore((s) => s.engine);
  const formattingProfile = useFilesStore((s) => s.engine.capabilities.formatting_profile);
  const isMarkdownFile = isMarkdownPath(activePath);
  const sourcePreview = sourcePreviewKind(activePath);
  const notesOn = useSettingsStore((s) => s.notes);
  const noteTab = useNoteTabsStore((s) => (notesOn ? activeNoteTab(s, projectId) : null));
  const asMarkdown = useNoteTabsStore((s) => editsAsMarkdown(s, projectId, activePath));
  const noteFile = useFilesStore(
    (s) =>
      !asMarkdown &&
      s.activePath !== null &&
      isEditorNoteFile(s.activePath, s.files[s.activePath]?.content, { notes: notesOn, projectKind: s.projectKind }),
  );
  const shownNote = shownNoteView({ projectId, activePath, noteTab, noteFile, diffFocused });
  const keptNotes = useKeptNoteTabs(shownNote, projectId, notesOn);
  const toolbarProfile = formattingProfileForPath(engine, engineLoaded, activePath);
  const showLatexToolbar = !zen && toolbarProfile === "latex";
  const markdownIsEngineSource =
    engineLoaded && formattingProfile === "markdown" && pathUsesEngineSource(engine, activePath);
  const showMarkdownToolbar = !zen && toolbarProfile === "markdown";
  const showTypstToolbar = !zen && toolbarProfile === "typst";

  const fileViewMode = useFileMode(activePath);
  const wysiwyg = fileViewMode === "visual";
  const markdownSplitLayout = useVisualModeStore((s) => s.markdownSplitLayout);
  const loadVisualMode = useVisualModeStore((s) => s.loadProject);
  useLayoutEffect(() => {
    loadVisualMode(projectId);
  }, [projectId, loadVisualMode]);
  useEffect(() => {
    if (projectId && activePath) useVisualModeStore.getState().remember(activePath);
  }, [projectId, activePath]);
  const toggleWysiwyg = () => setActiveFileMode(wysiwyg ? "code" : "visual");
  const appearanceTab = appearanceTabFor(wysiwyg, isMarkdownFile, toolbarProfile);
  const splitCapable = isMarkdownFile || sourcePreview !== null;
  const markdownSplit = splitCapable && fileViewMode === "both";
  const stackMarkdownSplit = markdownSplitLayout === "stacked";
  const markdownSourceSize = getMarkdownSplitSize(projectId);
  const saveMarkdownSplitSize = useCallback((layout: Layout) => {
    const sourceSize = layout[MARKDOWN_SOURCE_PANEL];
    if (projectId && sourceSize !== undefined && layout[MARKDOWN_PREVIEW_PANEL] !== undefined) {
      setMarkdownSplitSize(projectId, sourceSize);
    }
  }, [projectId]);
  const markdownGroupRef = useRef<GroupImperativeHandle>(null);
  const markdownSplitHitArea = useSeparatorHitArea(0.25);
  const onMarkdownSeparatorKeyDown = useSeparatorKeyboard(markdownGroupRef, MARKDOWN_SPLIT_LIMITS);
  const markdownVisual = wysiwyg && isMarkdownFile;
  const previewOnly = wysiwyg && sourcePreview !== null;
  const sourceHidden = markdownVisual || previewOnly;
  const changeDocumentMode = (mode: EditorMode, layout?: MarkdownSplitLayout) => {
    if (markdownVisual) flushWysiwygPendingEdits();
    if (layout) useVisualModeStore.getState().setMarkdownSplitLayout(layout);
    setActiveFileMode(mode);
  };
  const showBreadcrumbs =
    !zen &&
    !isDiagramMainFile && /\.(?:tex|latex|ltx|typ)$/iu.test(activePath ?? "");

  useEffect(() => {
    setWysiwygVisibilityController((visible) => {
      const path = useFilesStore.getState().activePath;
      if ((fileMode(useVisualModeStore.getState(), path) === "visual") !== visible) {
        setActiveFileMode(visible ? "visual" : "code");
      }
    });
    return () => setWysiwygVisibilityController(null);
  }, []);

  const revealSource = (from: number) => {
    if (!activePath) return;
    if (previewOnly) changeDocumentMode("both");
    void navigateToProjectRange({ path: activePath, range: { from, to: from }, source: "outline" });
  };

  const loading = <LoadingState className="h-full justify-center" label={t(($) => $.common.state.loading)} />;

  const renderSourcePreview = () => {
    if (!projectId || !activePath) return null;
    return (
      <Suspense fallback={loading}>
        {sourcePreview === "html" ? (
          <HtmlFilePreview projectId={projectId} path={activePath} />
        ) : sourcePreview === "bib" ? (
          <BibReferenceList path={activePath} onReveal={revealSource} />
        ) : sourcePreview === "deck" ? (
          <DeckView
            key={activePath}
            projectId={projectId}
            path={activePath}
            onPresent={(mode, page) =>
              void present({
                projectId,
                mode,
                page: page + 1,
                mainDoc: null,
                typst: false,
                source: { kind: "deck", path: activePath },
              })
            }
          />
        ) : (
          <SheetFilePreview projectId={projectId} path={activePath} />
        )}
      </Suspense>
    );
  };

  const renderTextArea = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      {managedFile ? (
        <output
          data-testid="managed-file-notice"
          className="border-b px-4 py-2 text-sm text-muted-foreground"
        >
          {t(($) => $.editor.shell.managedFileReadOnly, { file: activePath })}
        </output>
      ) : null}
      <ChangedOnDiskBanner />
      <NoteMarkdownBanner />
      {linkedFile && !managedFile ? (
        <output
          data-testid="linked-file-notice"
          className="border-b px-4 py-2 text-sm text-muted-foreground"
        >
          {t(($) => $.editor.shell.linkedFileReadOnly, { file: activePath })}
        </output>
      ) : null}
      {showBreadcrumbs ? <Breadcrumbs visual={wysiwyg} /> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      {isMarkdownFile ? (
        <div
          aria-hidden={!markdownVisual}
          inert={!markdownVisual ? true : undefined}
          className={cn(
            "absolute inset-0",
            !markdownVisual && "invisible pointer-events-none select-none",
          )}
        >
          <Suspense fallback={loading}>
            <WysiwygEditor wysiwyg={markdownVisual} />
          </Suspense>
        </div>
      ) : null}
      {previewOnly ? <div className="absolute inset-0">{renderSourcePreview()}</div> : null}
      <div
        aria-hidden={sourceHidden}
        inert={sourceHidden ? true : undefined}
        className={cn(
          "absolute inset-0",
          sourceHidden && "invisible pointer-events-none select-none",
        )}
      >
        <Group
          orientation={stackMarkdownSplit ? "vertical" : "horizontal"}
          groupRef={markdownGroupRef}
          onLayoutChanged={saveMarkdownSplitSize}
          resizeTargetMinimumSize={markdownSplitHitArea}
        >
          <Panel
            id={MARKDOWN_SOURCE_PANEL}
            defaultSize={percent(markdownSourceSize)}
            {...panelLimitProps(MARKDOWN_PANE_LIMITS)}
            style={PANEL_STYLE}
          >
            <div className="relative h-full">
              <EditorContextMenu>
                <CodeMirrorEditor active={!sourceHidden} />
              </EditorContextMenu>
              <Suspense fallback={null}>
                <EditorOutlineRail />
              </Suspense>
            </div>
            <SelectionActionMenu />
          </Panel>
          {markdownSplit && <>
            <Separator
              id="markdown-split-resize"
              disableDoubleClick
              aria-label={`${t(($) => $.editor.toolbar.code)} / ${sourcePreview ? t(($) => $.editor.toolbar.preview) : t(($) => $.editor.preview.markdown)}`}
              onKeyDownCapture={onMarkdownSeparatorKeyDown}
              className={cn("shrink-0 select-none bg-border/60 transition-colors hover:bg-primary/30 focus-visible:bg-primary/30",
                stackMarkdownSplit ? "h-1" : "w-1")}
            />
            <Panel
              id={MARKDOWN_PREVIEW_PANEL}
              defaultSize={percent(100 - markdownSourceSize)}
              {...panelLimitProps(MARKDOWN_PANE_LIMITS)}
              style={PANEL_STYLE}
            >
              {sourcePreview ? (
                renderSourcePreview()
              ) : (
                <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>}>
                  <MarkdownPreview key={`${projectId}:${activePath}`} />
                </Suspense>
              )}
            </Panel>
          </>}
        </Group>
      </div>
      </div>
    </div>
  );

  const wholeFile = (className: string, view: ReactNode) => (
    <div className={cn("min-h-0 flex-1", className)}>
      <Suspense fallback={loading}>{view}</Suspense>
    </div>
  );

  const renderFileArea = () => {
    if (isDiagramMainFile && wysiwyg && projectId && activePath) {
      return wholeFile("overflow-hidden", <DiagramMainFileView projectId={projectId} path={activePath} />);
    }
    if (isDiagramMainFile) {
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <EditorContextMenu>
            <CodeMirrorEditor />
          </EditorContextMenu>
          <SelectionActionMenu />
        </div>
      );
    }
    if (isPdfFile && projectId && activePath) {
      return wholeFile("overflow-auto bg-sidebar", <PdfFileView projectId={projectId} path={activePath} />);
    }
    if (isWorkbookFile && projectId && activePath) {
      return wholeFile("overflow-hidden", <SheetFilePreview projectId={projectId} path={activePath} workbook />);
    }
    if (isBoardFile && projectId && activePath) {
      return wholeFile("overflow-hidden", <BoardFileView projectId={projectId} path={activePath} />);
    }
    if (isImageFile && projectId && activePath) {
      return wholeFile("overflow-hidden bg-sidebar", <ImageFileView projectId={projectId} path={activePath} />);
    }
    if (isOpaqueFile && activePath) {
      return (
        <div
          data-testid="binary-file-notice"
          className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground"
        >
          <FileText className="mb-3 size-10 opacity-30" />
          <p className="text-sm">{basename(activePath)}</p>
          <p className="text-xs">{t(($) => $.editor.shell.binaryFile)}</p>
        </div>
      );
    }
    return renderTextArea();
  };

  const renderNote = (view: NoteTabView, shown: boolean) => (
    <div key={view.key} hidden={!shown} className={shown ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <ErrorBoundary surface="editor" resetKey={`${view.key}\u0000${shown}`}>
        <Suspense fallback={loading}>
          {view.kind === "personal" ? (
            <PersonalNoteTab projectId={view.projectId} noteId={view.noteId} shown={shown} />
          ) : (
            <ProjectNoteTab projectId={view.projectId} path={view.path} shown={shown} />
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  );

  const renderBody = () => {
    if (shownNote) return null;
    if (diffFocused) {
      return (
        <ErrorBoundary
          fallback={
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t(($) => $.editor.shell.diffCrashed)}
            </div>
          }
        >
          <DiffView />
        </ErrorBoundary>
      );
    }
    if (!hasOpenFile) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <FileText className="mb-3 size-10 opacity-30" />
          <p className="text-sm">{t(($) => $.editor.shell.noFileOpen)}</p>
          <p className="text-xs">{t(($) => $.editor.shell.noFileOpenHint)}</p>
        </div>
      );
    }
    return (
      <>
        {showLatexToolbar && (
          <div className="shrink-0">
            <EditorToolbar wysiwyg={wysiwyg} onToggleWysiwyg={toggleWysiwyg} />
          </div>
        )}
        {showMarkdownToolbar && (
          <div className="shrink-0">
            <MarkdownToolbar
              wysiwyg={markdownVisual}
              onToggleWysiwyg={isMarkdownFile ? toggleWysiwyg : undefined}
              mode={isMarkdownFile ? fileViewMode : undefined}
              splitLayout={markdownSplitLayout}
              onModeChange={isMarkdownFile ? changeDocumentMode : undefined}
              showProjectInfo={markdownIsEngineSource}
            />
          </div>
        )}
        {sourcePreview && !zen && (
          <div className="flex min-h-9 shrink-0 items-center border-b px-2">
            <WysiwygModeSwitch
              wysiwyg={previewOnly}
              onToggle={toggleWysiwyg}
              secondLabel={t(($) => $.editor.toolbar.preview)}
              mode={fileViewMode}
              splitLayout={markdownSplitLayout}
              onModeChange={changeDocumentMode}
            />
          </div>
        )}
        {showTypstToolbar && (
          <div className="shrink-0">
            <TypstToolbar
              wysiwyg={wysiwyg}
              onToggleWysiwyg={/\.typ$/iu.test(activePath ?? "") ? toggleWysiwyg : undefined}
            />
          </div>
        )}
        {renderFileArea()}
      </>
    );
  };

  return (
    <div
      ref={interactionRoot}
      data-tour="project-editor"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      {!zen && (
        <div {...paneBar} className={cn("flex h-9 shrink-0 items-center border-b", PANE_BAR_CLASS)}>
          <div className="flex shrink-0 items-center border-r border-border pl-2 pr-1">
            <SidebarCollapseToggle />
          </div>
          <EditorTabStrip diffFocused={diffFocused} />
          <div className="flex shrink-0 items-center gap-1 border-l border-border pl-1 pr-2">
            <Tooltip label={t(($) => $.editor.shell.editorSettings)} side="bottom">
              <button
                type="button"
                aria-label={t(($) => $.editor.shell.editorSettings)}
                onClick={() => useSettingsStore.getState().openSettingsAt("appearance", appearanceTab)}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              >
                <Settings2 className="size-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      <CollabRemovedFileSlot />
      {!diffFocused && !noteTab && !noteFile ? (
        <ProofreadingNotifications
          path={activePath}
          surface={markdownVisual ? "visual" : "source"}
        />
      ) : null}
      {renderBody()}
      {keptNotes.map(({ view, shown }) => renderNote(view, shown))}
    </div>
  );
}
