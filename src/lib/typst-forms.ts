import { invoke } from "@tauri-apps/api/core";
import type { TypstFormCatalog } from "@oleafly/editor/typst-forms";

// The forms the project's oleafly-forms.toml and the given packages' typst.toml declare.
// The backend reads the same package folders the compiler uses and never fetches.
export function loadTypstFormCatalog(projectId: string, packages: readonly string[]): Promise<TypstFormCatalog> {
  return invoke<TypstFormCatalog>("typst_form_catalog", { projectId, packages });
}
