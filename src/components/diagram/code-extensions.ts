import type { Extension } from "@codemirror/state";
import type { DiagramLanguageId } from "@oleafly/diagram";
import { typstLanguage } from "@oleafly/editor/typst";
import { latexLanguage } from "@/components/editor/cm/latex";
import { recompileShortcutGuard } from "@/components/editor/cm/recompile-shortcut";
import { editorTheme } from "@/components/editor/cm/theme";

/**
 * Extensions the app hands to the diagram composer's TikZ code editor. The
 * guard keeps the recompile chord from inserting a blank line there; the
 * package cannot read the app's shortcut bindings itself.
 */
export function diagramCodeExtensions(): Extension[] {
  return [latexLanguage(), editorTheme(), recompileShortcutGuard];
}

export function diagramLanguageExtensions(): Record<DiagramLanguageId, Extension[]> {
  return {
    tikz: diagramCodeExtensions(),
    typst: [typstLanguage(), editorTheme(), recompileShortcutGuard],
    mermaid: [editorTheme(), recompileShortcutGuard],
  };
}
