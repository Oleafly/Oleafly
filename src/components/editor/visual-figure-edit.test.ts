import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => { state: EditorState } | null>(() => null),
  replaceRange: vi.fn(),
  insertTemplate: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";
import { openVisualFigureEditor } from "./visual-figure-edit";

const TYPST = `Intro.
#figure(
  image("plots/a.png", width: 80%),
  caption: [A plot],
) <fig:a>
`;

function useDocument(path: string, doc: string): void {
  useFilesStore.setState({ activePath: path });
  controller.getEditorView.mockReturnValue({ state: EditorState.create({ doc }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFigureDialogStore.setState({ open: false, edit: null });
});

describe("openVisualFigureEditor", () => {
  it("opens the Typst figure dialog for the figure a visual image belongs to", async () => {
    useDocument("chapters/main.typ", TYPST);
    const from = TYPST.indexOf("#figure");
    await openVisualFigureEditor({ from, to: TYPST.indexOf("<fig:a>") + "<fig:a>".length });
    const { open, edit } = useFigureDialogStore.getState();
    expect(open).toBe(true);
    expect(edit).toMatchObject({ from, to: TYPST.indexOf("<fig:a>") + "<fig:a>".length, path: "plots/a.png", width: "80%" });
    expect(edit?.typst).toMatchObject({ path: "plots/a.png", caption: "A plot", label: "fig:a" });
  });

  it("does nothing for a Typst range without a figure", async () => {
    useDocument("main.typ", 'Text #image("a.png") end.');
    await openVisualFigureEditor({ from: 5, to: 20 });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("keeps the LaTeX figure editor for LaTeX files", async () => {
    const doc = String.raw`\includegraphics[width=3cm]{a.png}`;
    useDocument("main.tex", doc);
    await openVisualFigureEditor({ from: 0, to: doc.length });
    expect(useFigureDialogStore.getState().edit).toEqual({ from: 0, to: doc.length, path: "a.png", width: "3cm" });
  });
});
