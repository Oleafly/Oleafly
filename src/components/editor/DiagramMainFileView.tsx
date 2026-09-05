import { useCallback, useEffect, useRef, useState } from "react";
import { DiagramCanvas, DiagramKitContext } from "@oleafly/diagram";
import {
  buildStandaloneDoc,
  DIAGRAM_LIBS,
  parseEmbeddedModel,
  serializeDiagram,
  type DiagramModel,
} from "@oleafly/latex";
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
  const [background, setBackground] = useState("#ffffff");

  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setModel(null);
    const content = useFilesStore.getState().files[path]?.content ?? await readFileContent(projectId, path);
    if (generation !== loadGeneration.current || useFilesStore.getState().projectId !== projectId) return;
    const model = parseEmbeddedModel(content);
    setModel(model);
    setNotDrawable(!model);
    setBackground(model?.background ?? "#ffffff");
  }, [projectId, path]);
  useEffect(() => {
    setModel(null);
    setNotDrawable(false);
    void reload().catch(() => setNotDrawable(true));
    const unregister = registerEditorMutationOwner({
      projectId: () => projectId,
      reconcile: reload,
    });
    return () => {
      loadGeneration.current++;
      unregister();
    };
  }, [projectId, reload]);

  const onModelChange = (m: DiagramModel) => {
    const files = useFilesStore.getState();
    if (isEditorMutationLocked(projectId) || files.projectId !== projectId || files.activePath !== path) return;
    setModel(m);
    const doc = buildStandaloneDoc({
      code: serializeDiagram({ ...m, background }),
      libraries: DIAGRAM_LIBS,
      background,
    });
    useFilesStore.getState().setContent(path, doc);
  };

  if (notDrawable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        This diagram's TikZ wasn't authored in the composer, so it can't be shown as a canvas. Use the code view instead.
      </div>
    );
  }
  if (!model) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="h-full min-h-0">
      <DiagramKitContext.Provider value={KIT}>
        <DiagramCanvas model={model} onChange={onModelChange} />
      </DiagramKitContext.Provider>
    </div>
  );
}
