import type { Text } from "@codemirror/state";
import type { Editor } from "@tiptap/core";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Redo2, ScanSearch, SlidersHorizontal, Undo2 } from "lucide-react";
import { isQuartoEngine } from "@/lib/notebook-engines";
import type { EditorMode, MarkdownSplitLayout } from "@/lib/wysiwyg-mode";
import { Divider, IconBtn, WysiwygModeSwitch } from "@/components/editor/EditorToolbar";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import { useWysiwygEditor } from "@/components/editor/wysiwyg/controller";
import { ToolbarOverflow } from "@/components/ui/toolbar-overflow";
import { editorRedo, editorUndo, getEditorView } from "@/components/editor/cm/controller";
import { editorSelectionRevision, editorSelectionTyped, subscribeEditorSelection } from "@/components/editor/cm/cursor-signal";
import { useEditorHistory } from "@/components/editor/history-signal";
import { useCollabVisualReadOnly } from "@/lib/collab-live-bridge";
import { useActiveFileReadOnly } from "@/lib/read-only-files";
import { cn, shortcut } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

type ControlsModule = typeof import("./markdown-toolbar-controls");
type ToolbarState = ReturnType<ControlsModule["visualStateOf"]>;

const SOURCE_STATE_DELAY_MS = 100;
const SLOW_STATE_MS = 16;
let loadedControls: ControlsModule | null = null;
let loadingControls: Promise<ControlsModule> | null = null;

function loadControls(): Promise<ControlsModule> {
  loadingControls ??= import("./markdown-toolbar-controls").then((loaded) => {
    loadedControls = loaded;
    return loaded;
  });
  return loadingControls;
}

function useControlsModule(): ControlsModule | null {
  const [module, setModule] = useState<ControlsModule | null>(() => loadedControls);
  useEffect(() => {
    if (module) return;
    let live = true;
    void loadControls().then((loaded) => {
      if (live) setModule(loaded);
    });
    return () => {
      live = false;
    };
  }, [module]);
  return module;
}

function useVisualState(editor: Editor | null, controls: ControlsModule | null) {
  const [state, setState] = useState<ToolbarState>(null);
  useLayoutEffect(() => {
    if (!controls) return;
    const update = () =>
      setState((current) => {
        const next = controls.visualStateOf(editor);
        return controls.sameToolbarState(current, next) ? current : next;
      });
    update();
    if (!editor) return;
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor, controls]);
  return state;
}

function useSourceState(controls: ControlsModule | null, active: boolean) {
  const revision = useSyncExternalStore(subscribeEditorSelection, editorSelectionRevision, editorSelectionRevision);
  const [state, setState] = useState<ToolbarState>(null);
  const settled = useRef(false);
  const slow = useRef(false);
  const read = useRef<{ doc: Text | null; path: string | null }>({ doc: null, path: null });
  useLayoutEffect(() => {
    if (!controls || !active) {
      settled.current = false;
      return;
    }
    const update = () => {
      const started = performance.now();
      const view = getEditorView();
      const next = view ? controls.modelState(view.state) : controls.RESTING_STATE;
      slow.current = performance.now() - started > SLOW_STATE_MS;
      const doc = view?.state.doc ?? null;
      if (doc !== read.current.doc) read.current = { doc, path: useFilesStore.getState().activePath };
      setState((current) => (controls.sameToolbarState(current, next) ? current : next));
    };
    const switched = (getEditorView()?.state.doc ?? null) !== read.current.doc && useFilesStore.getState().activePath !== read.current.path;
    if (revision >= 0 && (!settled.current || switched || !(editorSelectionTyped() || slow.current))) {
      settled.current = true;
      update();
      return;
    }
    const timer = setTimeout(update, SOURCE_STATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [controls, active, revision]);
  return state;
}

function useWrapped(bar: RefObject<HTMLDivElement | null>, group: RefObject<HTMLDivElement | null>) {
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const row = bar.current;
    const own = group.current;
    if (!row || !own || typeof ResizeObserver === "undefined") return;
    const measure = () => setWrapped(row.firstElementChild !== own && own.offsetTop > (row.firstElementChild as HTMLElement).offsetTop);
    measure();
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(row);
    return () => observer.disconnect();
  }, [bar, group]);
  return wrapped;
}

export function MarkdownToolbar({
  wysiwyg,
  onToggleWysiwyg,
  mode,
  splitLayout,
  onModeChange,
  showProjectInfo = true,
}: Readonly<{
  wysiwyg: boolean;
  onToggleWysiwyg?: () => void;
  mode?: EditorMode;
  splitLayout?: MarkdownSplitLayout;
  onModeChange?: (mode: EditorMode, layout?: MarkdownSplitLayout) => void;
  showProjectInfo?: boolean;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const markdownProject = useFilesStore((state) => state.engineLoaded && state.engine.source_format === "markdown");
  const markdownSettings = useFilesStore((state) => !isQuartoEngine(state.engine));
  const projectId = useFilesStore((state) => state.projectId);
  const fileReadOnly = useActiveFileReadOnly();
  const collabReadOnly = useCollabVisualReadOnly(projectId);
  const readOnly = fileReadOnly || (wysiwyg && collabReadOnly);
  const visualEditor = useWysiwygEditor();
  const editor = wysiwyg ? visualEditor : null;
  const controls = useControlsModule();
  const visualState = useVisualState(editor, controls);
  const sourceState = useSourceState(controls, !wysiwyg);
  const row = useMemo(() => {
    if (!controls) return [];
    if (wysiwyg) {
      const target = editor ? controls.visualTarget(editor) : controls.IDLE_TARGET;
      return controls.markdownRow(target, visualState ?? controls.RESTING_STATE, t);
    }
    return controls.markdownRow(controls.sourceTarget(getEditorView), sourceState ?? controls.RESTING_STATE, t);
  }, [controls, editor, sourceState, t, visualState, wysiwyg]);

  const history = useEditorHistory(wysiwyg);
  const barRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const wrapped = useWrapped(barRef, groupRef);

  return (
    <div ref={barRef} data-markdown-toolbar className="flex min-h-9 flex-wrap items-center gap-0.5 gap-y-1 border-b px-2">
      {onToggleWysiwyg ? (
        <WysiwygModeSwitch
          wysiwyg={wysiwyg}
          onToggle={onToggleWysiwyg}
          mode={mode}
          splitLayout={splitLayout}
          onModeChange={onModeChange}
          data-tour="wysiwyg-toggle"
        />
      ) : null}
      <div ref={groupRef} className={cn("flex min-w-0 grow items-center gap-0.5", showProjectInfo ? "basis-90" : "basis-82")}>
        {onToggleWysiwyg && !wrapped ? <Divider /> : null}
        <IconBtn onClick={editorUndo} disabled={!history.canUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
          <Undo2 className="size-4" />
        </IconBtn>
        <IconBtn onClick={editorRedo} disabled={!history.canRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
          <Redo2 className="size-4" />
        </IconBtn>

        <Divider />

        <fieldset disabled={readOnly} className="contents">
          <ToolbarOverflow controls={row} separated label={t(($) => $.editor.toolbar.moreOptions)} />
        </fieldset>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {markdownProject && (
            <IconBtn
              onClick={() => useTypstDocumentPanelStore.getState().openPanel("insights")}
              title={t(($) => $.editor.typstInsights.title)}
            >
              <ScanSearch data-testid="document-insights-button" className="size-4" />
            </IconBtn>
          )}
          {markdownProject && markdownSettings && (
            <IconBtn
              onClick={() => useTypstDocumentPanelStore.getState().openPanel("settings")}
              title={t(($) => $.editor.typstSettings.title)}
            >
              <SlidersHorizontal data-testid="document-settings-button" className="size-4" />
            </IconBtn>
          )}
          {showProjectInfo && <ProjectInfoButton surface={wysiwyg ? "visual" : "source"} />}
        </div>
      </div>
    </div>
  );
}
