import { getEditorView } from "@/components/editor/cm/controller";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";
import { openFigureEditorAt } from "./figure-edit";

async function openTypstFigureEditorAt(range: { from: number; to: number }): Promise<void> {
  const view = getEditorView();
  if (!view) return;
  const { typstFigureAt } = await import("./typst-figure");
  const doc = view.state.doc.toString();
  const match = typstFigureAt(doc, Math.max(0, Math.min(range.from + 1, doc.length)));
  if (!match?.fields) return;
  useFigureDialogStore.getState().openForEdit({
    from: match.from,
    to: match.to,
    path: match.fields.path,
    width: match.fields.width,
    typst: match.fields,
  });
}

export async function openVisualFigureEditor(range: { from: number; to: number }): Promise<void> {
  if (/\.typ$/iu.test(useFilesStore.getState().activePath ?? "")) {
    await openTypstFigureEditorAt(range);
    return;
  }
  openFigureEditorAt(range);
}
