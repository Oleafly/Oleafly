import { Suspense } from "react";
import { lazy } from "@/lib/preloadable";
import { useSaveAsTemplateStore } from "@/store/save-as-template";

const SaveAsTemplateDialog = lazy(() =>
  import("@/components/library/SaveAsTemplateDialog").then((module) => ({
    default: module.SaveAsTemplateDialog,
  })), { warm: true });

export function SaveAsTemplateHost() {
  const open = useSaveAsTemplateStore((state) => state.target !== null);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SaveAsTemplateDialog />
    </Suspense>
  );
}
