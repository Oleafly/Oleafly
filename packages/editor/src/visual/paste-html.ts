import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToLatex } from "@oleafly/latex";
import { isVisualMode } from "./index";

const OPAQUE_CLIPBOARD_TYPES = ["application/vnd.code.copymetadata", "vscode-editor-data"];

export function latexFromClipboard(data: DataTransfer): string | null {
  if (!data.types.includes("text/html")) return null;
  if (OPAQUE_CLIPBOARD_TYPES.some((type) => data.types.includes(type))) return null;

  const html = data.getData("text/html").trim();
  if (html === "") return null;

  let latex: string | null = null;
  try {
    latex = htmlToLatex(html, { hasFiles: data.files.length > 0 });
  } catch {
    return null;
  }
  if (latex === null) return null;

  return latex === data.getData("text/plain").trim() ? null : latex;
}

export const pasteHtml: Extension = Prec.highest(
  EditorView.domEventHandlers({
    paste(event, view) {
      if (!isVisualMode(view.state)) return false;
      const data = event.clipboardData;
      if (!data) return false;

      const latex = latexFromClipboard(data);
      if (latex === null) return false;

      event.preventDefault();
      view.dispatch({
        ...view.state.replaceSelection(latex),
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      return true;
    },
  }),
);
