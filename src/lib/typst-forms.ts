import { invoke } from "@tauri-apps/api/core";
import type { TypstFormCatalog } from "@oleafly/editor/typst-forms";

export function loadTypstFormCatalog(projectId: string, packages: readonly string[]): Promise<TypstFormCatalog> {
  return invoke<TypstFormCatalog>("typst_form_catalog", { projectId, packages });
}
