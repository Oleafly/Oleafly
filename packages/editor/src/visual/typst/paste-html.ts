import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { visualModeActive } from "../facets";
import { htmlToTypst } from "./html-to-typst";

const OPAQUE_CLIPBOARD_TYPES = ["application/vnd.code.copymetadata", "vscode-editor-data"];

export function typstFromClipboard(data: DataTransfer): string | null {
  if (!data.types.includes("text/html")) return null;
  if (OPAQUE_CLIPBOARD_TYPES.some((type) => data.types.includes(type))) return null;
  const html = data.getData("text/html").trim();
  if (html === "") return null;
  let typst: string | null = null;
  try {
    typst = htmlToTypst(html, { hasFiles: data.files.length > 0 });
  } catch {
    return null;
  }
  if (typst === null) return null;
  return typst === data.getData("text/plain").trim() ? null : typst;
}

export const typstPasteHtml: Extension = Prec.highest(
  EditorView.domEventHandlers({
    paste(event, view) {
      if (!view.state.facet(visualModeActive) || view.state.readOnly) return false;
      const data = event.clipboardData;
      if (!data) return false;
      const typst = typstFromClipboard(data);
      if (typst === null) return false;
      event.preventDefault();
      view.dispatch({
        ...view.state.replaceSelection(typst),
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      return true;
    },
  }),
);
