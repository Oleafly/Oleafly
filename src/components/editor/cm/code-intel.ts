import { EditorView, keymap } from "@codemirror/view";
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";

export function codeIntel() {
  return [
    keymap.of([
      { key: "F12", run: (v) => goToDefinition(v) },
      { key: "Shift-F12", run: (v) => findReferences(v) },
      { key: "F2", run: (v) => startRename(v) },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        view.dispatch({ selection: { anchor: pos } });
        event.preventDefault();
        goToDefinition(view);
        return true;
      },
    }),
  ];
}
