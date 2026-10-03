import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DiagramCanvas,
  DiagramKitContext,
  diagramLanguage,
  languageForPath,
  mermaidBlocks,
  mermaidFigurePath,
  pngWithDpi,
  type DiagramKit,
  type DiagramLanguageId,
} from "@oleafly/diagram";
import {
  diagramFromSource,
  sameDiagramModel,
  type DiagramModel,
} from "@oleafly/latex";
import { editableStandaloneDiagram, standaloneDiagramSource } from "@/lib/diagram-source";
import { KIT } from "@/components/diagram/diagram-kit";
import { readFileContent, writeProjectBytes } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useProjectFolderReadOnly } from "@/store/folder-access";
import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";

interface LoadedDiagram {
  model: DiagramModel | null;
  editable: boolean;
  background?: string;
  write: (model: DiagramModel) => string;
  figure?: (doc: string) => string | null;
}

function loadTikz(content: string): LoadedDiagram {
  const editable = editableStandaloneDiagram(content);
  const model = editable ?? diagramFromSource(content);
  return { model, editable: Boolean(editable), background: model?.background, write: standaloneDiagramSource };
}

async function loadTypst(content: string): Promise<LoadedDiagram> {
  const language = diagramLanguage("typst");
  await language.load();
  const standalone = language.fromStandalone(content);
  const read = language.read(standalone.code);
  const typstVersion = () => {
    const { engine } = useFilesStore.getState();
    return engine.id === "typst" ? (engine.typst_resolved?.version ?? null) : null;
  };
  return {
    model: read.model,
    editable: read.model !== null && !read.notes.some((note) => note.kind === "dropped"),
    background: standalone.background ?? read.model?.background,
    write: (model) => language.standaloneSource(model, { extras: read.extras, typstVersion: typstVersion() }),
  };
}

function loadMermaid(content: string): LoadedDiagram {
  const language = diagramLanguage("mermaid");
  const block = mermaidBlocks(content)[0];
  const read = block ? language.read(block.code) : null;
  const firstBlock = (doc: string) => mermaidBlocks(doc)[0]?.code ?? null;
  if (!block || !read?.model) {
    return { model: null, editable: false, write: () => content, figure: firstBlock };
  }
  return {
    model: read.model,
    editable: !read.notes.some((note) => note.kind === "dropped"),
    write: (model) => {
      const code = language.fileSource(model, { extras: read.extras }).replace(/\s+$/, "");
      return `${content.slice(0, block.from)}${code}${content.slice(block.to)}`;
    },
    figure: firstBlock,
  };
}

async function exportMermaidFigure(projectId: string, code: string) {
  const { renderMermaidFigure } = await import("@/components/diagram/mermaid-render");
  const rendered = await renderMermaidFigure(code, { scale: 2, background: "#ffffff" });
  await writeProjectBytes(projectId, await mermaidFigurePath(code), pngWithDpi(rendered.pngBase64, 192));
}

function loadDiagram(language: DiagramLanguageId, content: string): Promise<LoadedDiagram> {
  if (language === "typst") return loadTypst(content);
  if (language === "mermaid") return Promise.resolve(loadMermaid(content));
  return Promise.resolve(loadTikz(content));
}

// Lazy-loaded from Editor.tsx (React.lazy): this is the only place the
// always-mounted editor would otherwise pull in @oleafly/diagram (and its
// @xyflow/react dependency), which used to bloat the main bundle.
export default function DiagramMainFileView({
  projectId,
  path,
}: Readonly<{
  projectId: string;
  path: string;
}>) {
  const { t } = useTranslation(["common", "editor", "diagram"]);
  const [model, setModel] = useState<DiagramModel | null>(null);
  const [notDrawable, setNotDrawable] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [mutationLocked, setMutationLocked] = useState(false);
  const folderReadOnly = useProjectFolderReadOnly(projectId);
  const loadedSource = useRef<string | null>(null);
  const background = useRef<string | undefined>(undefined);
  const writer = useRef<(model: DiagramModel) => string>(standaloneDiagramSource);
  const figure = useRef<((doc: string) => string | null) | undefined>(undefined);
  const figureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = languageForPath(path) ?? "tikz";
  const lang = diagramLanguage(language);

  const kit = useMemo<DiagramKit>(
    () => ({
      ...KIT,
      t: (key, params) =>
        (t as unknown as (k: string, p?: Record<string, unknown>) => string)(
          `diagram:package.${key}`,
          params,
        ),
    }),
    [t],
  );

  const loadGeneration = useRef(0);
  // React Flow emits a model on its first measurement pass, with no user
  // action behind it. Writing that back would rewrite hand-written TikZ into
  // generated form the moment the file is opened.
  const loadedModel = useRef<DiagramModel | null>(null);
  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setModel(null);
    const content = useFilesStore.getState().files[path]?.content ?? await readFileContent(projectId, path);
    if (generation !== loadGeneration.current || useFilesStore.getState().projectId !== projectId) return;
    const loaded = await loadDiagram(language, content);
    if (generation !== loadGeneration.current) return;
    loadedSource.current = content;
    background.current = loaded.background;
    writer.current = loaded.write;
    figure.current = loaded.figure;
    setReadOnly(!loaded.editable);
    loadedModel.current = loaded.model;
    setModel(loaded.model);
    setNotDrawable(!loaded.model);

  }, [projectId, path, language]);
  useEffect(() => {
    setModel(null);
    setNotDrawable(false);
    void reload().catch(() => setNotDrawable(true));
    const unregister = registerEditorMutationOwner({
      projectId: () => projectId,
      reconcile: reload,
      setLocked: setMutationLocked,
    });
    return () => {
      loadGeneration.current++;
      if (figureTimer.current) clearTimeout(figureTimer.current);
      unregister();
    };
  }, [projectId, reload]);

  const onModelChange = (m: DiagramModel) => {
    const files = useFilesStore.getState();
    if (readOnly || folderReadOnly || isEditorMutationLocked(projectId) || files.projectId !== projectId || files.activePath !== path) return;
    if (files.files[path]?.content !== loadedSource.current) {
      setReadOnly(true);
      void reload().catch(() => setNotDrawable(true));
      return;
    }
    if (sameDiagramModel(loadedModel.current, m)) return;
    const next = { ...m, background: background.current };
    loadedModel.current = m;
    setModel(m);
    const doc = writer.current(next);
    loadedSource.current = doc;
    useFilesStore.getState().setContent(path, doc);
    const block = figure.current?.(doc);
    if (block) {
      if (figureTimer.current) clearTimeout(figureTimer.current);
      figureTimer.current = setTimeout(() => {
        void exportMermaidFigure(projectId, block).catch(() => undefined);
      }, 800);
    }
  };

  if (notDrawable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {language === "tikz" ? t(($) => $.editor.diagram.notDrawable) : t(($) => $.diagram.package.notes.notDiagram)}
      </div>
    );
  }
  if (!model) {
    return <div className="p-6 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {readOnly && (
        <output className="border-b px-4 py-2 text-sm text-muted-foreground">
          {t(($) => $.editor.diagram.readOnlyNotice)}
        </output>
      )}
      <DiagramKitContext.Provider value={kit}>
        <DiagramCanvas
          model={model}
          onChange={onModelChange}
          readOnly={readOnly || mutationLocked || folderReadOnly}
          seeds={lang.seeds}
        />
      </DiagramKitContext.Provider>
    </div>
  );
}
