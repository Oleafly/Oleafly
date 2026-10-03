import { lazy, Suspense } from "react";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

const DocumentInsightsDialog = lazy(() =>
  import("@/components/editor/DocumentInsightsDialog").then((module) => ({ default: module.DocumentInsightsDialog })),
);
const DocumentSettingsDialog = lazy(() =>
  import("@/components/editor/DocumentSettingsDialog").then((module) => ({
    default: module.DocumentSettingsDialog,
  })),
);

export function TypstDocumentPanels() {
  const panel = useTypstDocumentPanelStore((state) => state.panel);
  const closePanel = useTypstDocumentPanelStore((state) => state.closePanel);
  if (!panel) return null;
  return (
    <Suspense fallback={null}>
      {panel === "insights" ? (
        <DocumentInsightsDialog onClose={closePanel} />
      ) : (
        <DocumentSettingsDialog onClose={closePanel} />
      )}
    </Suspense>
  );
}
