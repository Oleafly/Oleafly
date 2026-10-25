import { EditorView, keymap } from "@codemirror/view";
import { goToDefinition, findReferences } from "@/lib/index/nav";
import { renameAtCursor } from "@/lib/file-references/rename-trigger";
import { openVisualLinkHref } from "@/features/file-links";
import { linkTargetAt } from "./link-follow";

export function codeIntel() {
  return [
    keymap.of([
      { key: "F12", run: (v) => goToDefinition(v) },
      { key: "Shift-F12", run: (v) => findReferences(v) },
      { key: "F2", run: (v) => renameAtCursor(v) },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const line = view.state.doc.lineAt(pos);
        const target = linkTargetAt(line.text, pos - line.from);
        if (target && openVisualLinkHref(target)) {
          event.preventDefault();
          return true;
        }
        view.dispatch({ selection: { anchor: pos } });
        event.preventDefault();
        goToDefinition(view, "pointer");
        return true;
      },
    }),
  ];
}
