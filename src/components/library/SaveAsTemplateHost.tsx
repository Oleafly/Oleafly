import { lazy, Suspense } from "react";
import { useSaveAsTemplateStore } from "@/store/save-as-template";

// The dialog loads the first time a project is saved as a template, so it
// stays out of the startup bundle.
const SaveAsTemplateDialog = lazy(() =>
  import("@/components/library/SaveAsTemplateDialog").then((module) => ({
    default: module.SaveAsTemplateDialog,
  })),
);

/** Mounts the Save as template dialog while a project has asked for it. */
export function SaveAsTemplateHost() {
  const open = useSaveAsTemplateStore((state) => state.target !== null);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SaveAsTemplateDialog />
    </Suspense>
  );
}
