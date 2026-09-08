import { useCallback, useEffect, useRef, useState } from "react";
import { DiagramCanvas, DiagramKitContext } from "@oleafly/diagram";
import {
  diagramFromSource,
  sameDiagramModel,
  type DiagramModel,
} from "@oleafly/latex";
import { editableStandaloneDiagram, standaloneDiagramSource } from "@/lib/diagram-source";
import { KIT } from "@/components/diagram/diagram-kit";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";

// Lazy-loaded from Editor.tsx (React.lazy): this is the only place the
// always-mounted editor would otherwise pull in @oleafly/diagram (and its
// @xyflow/react dependency), which used to bloat the main bundle.
export default function DiagramMainFileView({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const [model, setModel] = useState<DiagramModel | null>(null);
  const [notDrawable, setNotDrawable] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [mutationLocked, setMutationLocked] = useState(false);
  const loadedSource = useRef<string | null>(null);
  const background = useRef<string | undefined>(undefined);

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
    const editable = editableStandaloneDiagram(content);
    const model = editable ?? diagramFromSource(content);
    loadedSource.current = content;
    background.current = model?.background;
    setReadOnly(!editable);
    loadedModel.current = model;
    setModel(model);
    setNotDrawable(!model);

  }, [projectId, path]);
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
      unregister();
    };
  }, [projectId, reload]);

  const onModelChange = (m: DiagramModel) => {
    const files = useFilesStore.getState();
    if (readOnly || isEditorMutationLocked(projectId) || files.projectId !== projectId || files.activePath !== path) return;
    if (files.files[path]?.content !== loadedSource.current) {
      setReadOnly(true);
      void reload().catch(() => setNotDrawable(true));
      return;
    }
    if (sameDiagramModel(loadedModel.current, m)) return;
    const next = { ...m, background: background.current };
    loadedModel.current = m;
    setModel(m);
    const doc = standaloneDiagramSource(next);
    loadedSource.current = doc;
    useFilesStore.getState().setContent(path, doc);
  };

  if (notDrawable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No shapes could be read out of this file's TikZ, so there is nothing to draw. Use the code view instead.
      </div>
    );
  }
  if (!model) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {readOnly && (
        <div role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
          This file contains source that Draw cannot preserve. The canvas is a partial, read-only preview. Use Code to edit the original file.
        </div>
      )}
      <DiagramKitContext.Provider value={KIT}>
        <DiagramCanvas model={model} onChange={onModelChange} readOnly={readOnly || mutationLocked} />
      </DiagramKitContext.Provider>
    </div>
  );
}
