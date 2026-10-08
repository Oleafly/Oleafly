// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroHit } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  hits: [] as ZoteroHit[],
  ensure: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/components/zotero/use-zotero-search", () => ({
  useZoteroSearch: (query: string) => ({ hits: query ? mocks.hits : [], pending: false }),
}));
vi.mock("@/features/zotero-cite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/zotero-cite")>()),
  ensureZoteroEntries: mocks.ensure,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCitationStore } from "@/store/citation";
import { useFilesStore } from "@/store/files";
import { AddCitationDialog } from "./AddCitationDialog";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const copy = enShell.addCitation;

const COX: ZoteroHit = {
  library: "user",
  itemKey: "COX1972R",
  citationKey: "cox1972regression",
  keySource: "bbt",
  title: "Regression Models and <i>Life-Tables</i> &amp; Discussion",
  authors: ["Cox"],
  authorCount: 1,
  year: "1972",
  itemType: "journalArticle",
  dateModified: "2024-01-01T00:00:00Z",
  score: 1,
};

function editor(path: string, marked: string): EditorView {
  const at = marked.indexOf("|");
  const view = new EditorView({
    state: EditorState.create({ doc: marked.replace("|", ""), selection: { anchor: at } }),
    parent: document.body,
  });
  useFilesStore.setState({ projectId: "zotero-dialog", activePath: path, engine: LATEX_ENGINE, engineLoaded: true });
  setEditorView(view);
  return view;
}

beforeEach(() => {
  mocks.hits = [COX];
  mocks.ensure.mockReset().mockResolvedValue({ added: ["cox1972regression"], reused: [], bibPath: "refs.bib" });
  mocks.success.mockClear();
  useCitationStore.setState({ open: true });
});

afterEach(() => {
  setEditorView(null);
  document.body.replaceChildren();
  useFilesStore.setState({ projectId: null, activePath: null });
});

describe("AddCitationDialog with Zotero", () => {
  it("keeps the search field free of autocorrect and capitalisation", () => {
    editor("main.tex", "See |");
    render(<AddCitationDialog />);
    const field = screen.getByPlaceholderText(copy.placeholder);
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("autocapitalize", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });

  it("shows library titles as plain text", async () => {
    editor("main.tex", "See |");
    render(<AddCitationDialog />);
    await userEvent.setup().type(screen.getByPlaceholderText(copy.placeholder), "cox");
    const row = await screen.findByRole("button", { name: /cox1972regression/u });
    expect(row).toHaveTextContent("Regression Models and Life-Tables & Discussion");
    expect(row.textContent).not.toMatch(/<\/?i>|&amp;/u);
  });

  it("adds a library item to the cite list the caret is in", async () => {
    const view = editor("main.tex", "See \\cite{efron1979bootstrap,benjamini1995controlling|} now.");
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "cox");
    await user.click(await screen.findByRole("button", { name: /cox1972regression/u }));
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
    expect(view.state.doc.toString()).toBe("See \\cite{efron1979bootstrap,benjamini1995controlling,cox1972regression} now.");
    expect(mocks.ensure).toHaveBeenCalledWith(
      [expect.objectContaining({ key: "cox1972regression" })],
      expect.anything(),
    );
    expect(mocks.success).toHaveBeenCalledWith(copy.added.replace("{{cite}}", "cox1972regression"));
  });

  it("names the whole citation when it writes one in prose", async () => {
    const view = editor("main.tex", "See |.");
    render(<AddCitationDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "cox");
    await user.click(await screen.findByRole("button", { name: /cox1972regression/u }));
    await waitFor(() => expect(useCitationStore.getState().open).toBe(false));
    expect(view.state.doc.toString()).toBe("See \\cite{cox1972regression}.");
    expect(mocks.success).toHaveBeenCalledWith(copy.added.replace("{{cite}}", "\\cite{cox1972regression}"));
  });
});
