import { useEffect, useState } from "react";
import { DiagramCanvas, DiagramKitContext } from "@oleafly/diagram";
import { parseEmbeddedModel, serializeDiagram, type DiagramModel } from "@oleafly/latex";
import { KIT } from "@/components/diagram/diagram-kit";
import { readFileContent, writeFileContent } from "@/lib/tauri";

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

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setNotDrawable(false);
    readFileContent(projectId, path).then((content) => {
      if (cancelled) return;
      const m = parseEmbeddedModel(content);
      if (m) {
        setModel(m);
        setBackground(m.background !== undefined ? m.background : "#ffffff");
      } else {
        setNotDrawable(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  const onModelChange = (m: DiagramModel) => {
    setModel(m);
    void writeFileContent(projectId, path, serializeDiagram({ ...m, background }));
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
