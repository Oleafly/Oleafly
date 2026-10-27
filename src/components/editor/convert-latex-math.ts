import { i18n } from "@/i18n";
import { notifyError, toast } from "@/lib/toast";
import { convertLatexMathSelection } from "@oleafly/editor/typst-math-paste";
import { getEditorView } from "./cm/controller";

export async function convertLatexMathAtSelection(): Promise<void> {
  const view = getEditorView();
  if (!view) return;
  try {
    if (await convertLatexMathSelection(view)) return;
    toast.infoUnique("convert-latex-math", i18n.t(($) => $.editor.contextMenu.noLatexMath));
  } catch (error) {
    notifyError("convert latex math", error);
  }
}
