import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => { state: EditorState } | null>(() => null),
  replaceRange: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import { useFigureDialogStore } from "@/store/figure-dialog";
import {
  applyFigureEdit,
  formatIncludeGraphics,
  openFigureEditorAt,
  parseIncludeGraphics,
} from "./figure-edit";

const DOC = String.raw`\begin{figure}
  \includegraphics[width=0.5\linewidth]{figures/plot.png}
\end{figure}`;

function viewWith(doc: string) {
  return { state: EditorState.create({ doc }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  controller.getEditorView.mockReturnValue(null);
  useFigureDialogStore.setState({ open: false, edit: null });
});

describe("parseIncludeGraphics", () => {
  it("reads the path and the width option", () => {
    expect(parseIncludeGraphics(String.raw`\includegraphics[width=0.5\linewidth]{a.png}`)).toEqual({
      path: "a.png",
      width: String.raw`0.5\linewidth`,
    });
    expect(parseIncludeGraphics(String.raw`\includegraphics{a.png}`)).toEqual({
      path: "a.png",
      width: null,
    });
    expect(
      parseIncludeGraphics(String.raw`\includegraphics[scale=2,width=3cm,angle=90]{b}`),
    ).toEqual({ path: "b", width: "3cm" });
  });

  it("allows spaces around the option group", () => {
    expect(parseIncludeGraphics(String.raw`\includegraphics [width=1cm] {a.png}`)).toEqual({
      path: "a.png",
      width: "1cm",
    });
    expect(parseIncludeGraphics(String.raw`\includegraphics   {b.png}`)).toEqual({
      path: "b.png",
      width: null,
    });
  });

  it("returns nothing when the range holds no image", () => {
    expect(parseIncludeGraphics(String.raw`\caption{Plot}`)).toBeNull();
    expect(parseIncludeGraphics("")).toBeNull();
  });
});

describe("formatIncludeGraphics", () => {
  it("writes the width option only when there is one", () => {
    expect(formatIncludeGraphics({ path: "a.png", width: String.raw`\linewidth` })).toBe(
      String.raw`\includegraphics[width=\linewidth]{a.png}`,
    );
    expect(formatIncludeGraphics({ path: "a.png", width: null })).toBe(
      String.raw`\includegraphics{a.png}`,
    );
  });
});

describe("openFigureEditorAt", () => {
  it("opens the dialog on the image in the range", () => {
    controller.getEditorView.mockReturnValue(viewWith(DOC));
    const from = DOC.indexOf("\\includegraphics");
    const to = DOC.indexOf("}", DOC.indexOf("{figures")) + 1;

    openFigureEditorAt({ from, to });

    expect(useFigureDialogStore.getState()).toMatchObject({
      open: true,
      edit: { from, to, path: "figures/plot.png", width: String.raw`0.5\linewidth` },
    });
  });

  it("stays closed without an editor or without an image", () => {
    openFigureEditorAt({ from: 0, to: 10 });
    expect(useFigureDialogStore.getState().open).toBe(false);

    controller.getEditorView.mockReturnValue(viewWith("Body text.\n"));
    openFigureEditorAt({ from: 0, to: 10 });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });
});

describe("applyFigureEdit", () => {
  it("replaces only the command it was opened on", () => {
    applyFigureEdit(
      { from: 4, to: 40, path: "old.png", width: null },
      { path: "new.png", width: "3cm" },
    );
    expect(controller.replaceRange).toHaveBeenCalledWith(
      4,
      40,
      String.raw`\includegraphics[width=3cm]{new.png}`,
    );
  });
});
