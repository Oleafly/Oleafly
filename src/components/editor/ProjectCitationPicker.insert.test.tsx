// @vitest-environment jsdom
import type { ReactNode } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "knuth1984";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/project-intelligence/current", () => ({
  currentProjectIntelligence: () => ({
    snapshot: { status: "success", bibliography: { entries: [{ id: "entry-0", key: "knuth1984" }] } },
  }),
}));
vi.mock("@/lib/project-intelligence/selectors", () => ({
  citationCompletions: () => [
    {
      id: "refs.bib#knuth",
      key: "knuth1984",
      label: "knuth1984",
      detail: "book",
      type: "book",
      location: { file: "refs.bib", range: { from: 0, to: 10, startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 } },
      duplicate: false,
      duplicateIndex: 0,
      duplicateCount: 1,
    },
  ],
}));

import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { ProjectCitationPicker } from "./ProjectCitationPicker";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

function pick(path: string, marked: string): EditorView {
  const at = marked.indexOf("|");
  const doc = marked.slice(0, at) + marked.slice(at + 1);
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: at } }),
    parent: document.body.appendChild(document.createElement("div")),
  });
  useFilesStore.setState({
    projectId: "paper",
    mainDoc: path,
    activePath: path,
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: { [path]: { content: doc, dirty: false } },
  } as never);
  useIndexStore.setState({
    texts: {},
    intelligenceState: { status: "success", identity: null, data: null, stale: false },
  } as never);
  setEditorView(view);
  render(<ProjectCitationPicker variant="menu" />);
  const row = screen.getByText(KEY).closest("button");
  if (!row) throw new Error("citation row missing");
  fireEvent.click(row);
  return view;
}

afterEach(() => {
  setEditorView(null);
  document.body.replaceChildren();
});

describe("ProjectCitationPicker inserting next to existing citations", () => {
  it("adds the key to the LaTeX cite list the caret is in", () => {
    const view = pick("main.tex", "See \\cite{a,b|} now.");
    expect(view.state.doc.toString()).toBe("See \\cite{a,b,knuth1984} now.");
  });

  it("writes the document's own cite command in LaTeX prose", () => {
    const view = pick("main.tex", "\\citep{a} and |.");
    expect(view.state.doc.toString()).toBe("\\citep{a} and \\citep{knuth1984}.");
  });

  it("joins a Markdown citation group or follows a bare citation", () => {
    const grouped = pick("paper.md", "As [@a; @b|] shows.");
    expect(grouped.state.doc.toString()).toBe("As [@a; @b; @knuth1984] shows.");
    document.body.replaceChildren();
    const bare = pick("paper.md", "As @a| shows.");
    expect(bare.state.doc.toString()).toBe("As @a @knuth1984 shows.");
  });

  it("adds a Typst reference after the one the caret is in", async () => {
    const view = pick("main.typ", 'As @ef|ron.\n#bibliography("refs.bib")');
    await waitFor(() => expect(view.state.doc.toString()).toBe('As @efron @knuth1984.\n#bibliography("refs.bib")'));
  });
});
