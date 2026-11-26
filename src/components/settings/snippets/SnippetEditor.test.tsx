// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildLibrary, parseSnippetFile, type ParsedSnippetFile, type SnippetRecord, serializeBody } from "@oleafly/snippets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { draftFromRecord, newDraft } from "@/features/snippets/draft";
import { useSnippetStore } from "@/features/snippets/store";
import { SnippetEditor, type SnippetEditorStart } from "./SnippetEditor";

const copy = enSettings.snippets.editor;
const initial = useSnippetStore.getState();
const saveRecord = vi.fn(async (_collection: string, _record: SnippetRecord) => undefined);
const deleteRecord = vi.fn(async (_collection: string, _id: string) => undefined);
const onClose = vi.fn();

function file(collection: string, layer: "user" | "pack", entries: Record<string, unknown>): ParsedSnippetFile {
  return parseSnippetFile(JSON.stringify(entries), collection, layer);
}

const PAPER = file("paper-structure", "pack", {
  $pack: { name: "Paper structure" },
  "paper.figure": { name: "Figure", prefix: "fig", body: { latex: `\\begin{figure}\${1|htbp,t|}\\end{figure}`, typst: "#figure($1)" } },
  "paper.figures": { name: "Subfigures", prefix: "figs", body: { latex: "\\begin{figure}$1\\end{figure}" } },
});
const MINE = file("my-snippets", "user", {
  "user.rtab": { name: "Results table", prefix: "rtab", body: "\\begin{table}$1\\end{table}", languages: ["latex"] },
});
const IMPORTED = file("imported", "user", {});

function setup(start: SnippetEditorStart) {
  const files = [PAPER, MINE, IMPORTED];
  useSnippetStore.setState({
    status: "ready",
    files,
    library: buildLibrary({ files, disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }),
    disk: [
      { name: "my-snippets.json", modifiedMs: 1, text: "{}", parsed: MINE, good: MINE },
      { name: "imported.json", modifiedMs: 1, text: "{}", parsed: IMPORTED, good: IMPORTED },
      { name: "_state.json", modifiedMs: 1, text: "{}", parsed: IMPORTED, good: null },
    ],
    saveRecord,
    deleteRecord,
  });
  return render(<SnippetEditor start={start} onClose={onClose} />);
}

function body(): EditorView {
  const editor = screen.getByTestId("snippet-body").querySelector(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor as HTMLElement) : null;
  if (!view) throw new Error("no body editor");
  return view;
}

function setBody(text: string, cursor = text.length) {
  const view = body();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(cursor) });
}

function saved(): [string, SnippetRecord] {
  const call = saveRecord.mock.calls.at(-1);
  if (!call) throw new Error("not saved");
  return call;
}

const FIGURE = PAPER.records[0];
const RTAB = MINE.records[0];

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  useSnippetStore.setState(initial, true);
});

describe("SnippetEditor", () => {
  it("writes a new snippet to My snippets", async () => {
    setup({ base: null, draft: newDraft("latex") });
    expect(screen.getByText(copy.newTitle, { selector: "[aria-current]" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(copy.name), "Proof block");
    await userEvent.type(screen.getByLabelText(copy.trigger), "prf");
    setBody("\\begin{proof}\n\t$1\n\\end{proof}");
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    const [collection, record] = saved();
    expect(collection).toBe("my-snippets");
    expect(record).toMatchObject({ id: "user.proof-block", name: "Proof block", trigger: "prf", languages: ["latex"], expand: "tab", inWord: false });
    expect(serializeBody(record.bodies.default ?? [])).toBe("\\begin{proof}\n\t$1\n\\end{proof}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks for a name and a body, and shows broken field syntax", async () => {
    setup({ base: null, draft: newDraft("latex") });
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(screen.getByText(copy.missingName)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(copy.name), "Draft");
    expect(screen.getByText(copy.missingBody)).toBeInTheDocument();
    setBody("${1:open");
    expect(await screen.findByText(/never closed/u)).toBeInTheDocument();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("adds the next free field, a choice, a variable and a project field at the caret", async () => {
    setup({ base: null, draft: newDraft("latex") });
    await userEvent.click(screen.getByRole("switch", { name: copy.showSyntax }));
    setBody("\\frac{$1}{}", 10);
    await userEvent.click(screen.getByRole("button", { name: copy.addField }));
    expect(body().state.doc.toString()).toBe(`\\frac{$1}{\${2}}`);
    const view = body();
    view.dispatch({ changes: { from: 0, insert: "x " }, selection: EditorSelection.single(0, 1) });
    await userEvent.click(screen.getByRole("button", { name: copy.addField }));
    expect(body().state.doc.toString()).toBe(`\${3:x} \\frac{$1}{\${2}}`);
    body().dispatch({ selection: EditorSelection.cursor(body().state.doc.length) });
    await userEvent.click(screen.getByRole("button", { name: copy.addChoice }));
    expect(body().state.doc.toString()).toMatch(/\$\{4\|first,second\|\}$/u);
    await userEvent.click(screen.getByRole("button", { name: copy.variable }));
    await userEvent.click(await screen.findByRole("menuitem", { name: copy.variables.DATE }));
    expect(body().state.doc.toString()).toMatch(/\$\{DATE:D MMMM YYYY\}$/u);
    await userEvent.click(screen.getByRole("button", { name: copy.variable }));
    await userEvent.click(await screen.findByRole("menuitem", { name: copy.variables.SELECTION }));
    expect(body().state.doc.toString()).toMatch(/\$\{SELECTION\}$/u);
    await userEvent.click(screen.getByRole("button", { name: copy.projectField }));
    await userEvent.click(await screen.findByRole("menuitem", { name: copy.projectFields.image }));
    expect(body().state.doc.toString()).toMatch(/\$\{5@image\}$/u);
  });

  it("shows fields as chips until Show syntax is on", async () => {
    setup({ base: RTAB, draft: draftFromRecord(RTAB) });
    expect(screen.getByText(copy.chipsNote)).toBeInTheDocument();
    expect(screen.getByTestId("snippet-body").querySelector("[data-snippet-chip]")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("switch", { name: copy.showSyntax }));
    expect(screen.queryByText(copy.chipsNote)).toBeNull();
    expect(screen.getByTestId("snippet-body").querySelector("[data-snippet-chip]")).toBeNull();
  });

  it("gives each chosen language its own body tab", async () => {
    setup({ base: null, draft: newDraft("latex") });
    setBody("shared");
    await userEvent.click(screen.getByRole("button", { name: "Typst" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["LaTeX", "Typst"]);
    await userEvent.click(screen.getByRole("tab", { name: "Typst" }));
    expect(body().state.doc.toString()).toBe("shared");
    setBody("typst body");
    await userEvent.click(screen.getByRole("button", { name: "LaTeX" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Typst"]);
    await userEvent.click(screen.getByRole("button", { name: "Typst" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([copy.anyLanguage]);
    expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    await userEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([copy.anyLanguage]);
  });

  it("chooses where and how the snippet fires", async () => {
    setup({ base: null, draft: newDraft("latex") });
    await userEvent.type(screen.getByLabelText(copy.name), "Fraction");
    await userEvent.type(screen.getByLabelText(copy.trigger), "//");
    setBody("\\frac{$1}{$2}");
    await userEvent.click(screen.getByRole("button", { name: copy.expandOptions.auto }));
    expect(screen.getByText(/as soon as you type \/\//u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.whereOptions.math }));
    expect(screen.getByText(copy.whereHelp.math)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.mathKinds["inline-math"] }));
    await userEvent.click(screen.getByLabelText(copy.wholeWord));
    await userEvent.click(screen.getByLabelText(copy.lineStart));
    await userEvent.click(screen.getByRole("combobox", { name: copy.collection }));
    await userEvent.click(await screen.findByRole("option", { name: "imported" }));
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    const [collection, record] = saved();
    expect(collection).toBe("imported");
    expect(record).toMatchObject({ expand: "auto", place: "inline-math", inWord: true, lineStart: true });
  });

  it("moves one of your snippets to the collection chosen", async () => {
    setup({ base: RTAB, draft: draftFromRecord(RTAB) });
    await userEvent.click(screen.getByRole("combobox", { name: copy.collection }));
    await userEvent.click(await screen.findByRole("option", { name: "imported" }));
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(saved()).toEqual(["imported", expect.objectContaining({ id: "user.rtab", collection: "imported" })]);
    expect(deleteRecord).toHaveBeenCalledWith("my-snippets", "user.rtab");
  });

  it("saves a regular expression trigger", async () => {
    setup({ base: null, draft: newDraft("latex") });
    await userEvent.type(screen.getByLabelText(copy.name), "Subscript");
    await userEvent.type(screen.getByLabelText(copy.trigger), "([[a-z])(\\d)");
    await userEvent.click(screen.getByLabelText(copy.regex));
    setBody("[[0]]_[[1]]");
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(saved()[1].regex).not.toBeNull();
  });

  it("saves a pack snippet as a change to its own collection and warns about shared starts", async () => {
    setup({ base: FIGURE, draft: draftFromRecord(FIGURE) });
    expect(screen.getByText(/updates to Paper structure still reach you/u)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: copy.collection })).toBeNull();
    expect(screen.getByTestId("snippet-clash-shared-start")).toHaveTextContent(
      "Shares its start with figs (Paper structure). They all show in the list, and Tab picks the exact match, fig.",
    );
    await userEvent.clear(screen.getByLabelText(copy.trigger));
    await userEvent.type(screen.getByLabelText(copy.trigger), "rtab");
    expect(screen.getByTestId("snippet-clash-duplicate")).toHaveTextContent("Results table (My snippets) also uses rtab.");
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    const [collection, record] = saved();
    expect(collection).toBe("paper-structure");
    expect(record).toMatchObject({ id: "paper.figure", trigger: "rtab", layer: "pack" });
  });

  it("lists at most three clashing snippets", async () => {
    const many = file("many", "pack", Object.fromEntries(["a1", "a2", "a3", "a4"].map((key) => [key, { prefix: key, body: "x" }])));
    const files = [many];
    setup({ base: null, draft: newDraft("latex") });
    useSnippetStore.setState({ files, library: buildLibrary({ files, disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }) });
    await userEvent.type(screen.getByLabelText(copy.trigger), "a");
    expect(screen.getByTestId("snippet-clash-shared-start")).toHaveTextContent("a1 (many), a2 (many), a3 (many), …");
  });

  it("warns about an auto trigger that is an ordinary word", async () => {
    setup({ base: null, draft: { ...newDraft("latex"), name: "In", expand: "auto", place: "text", bodies: { latex: "\\in" } } });
    await userEvent.type(screen.getByLabelText(copy.trigger), "in");
    expect(screen.getByText('"in" could expand while you write ordinary words')).toBeInTheDocument();
  });

  it("turns off a pack snippet and deletes one of yours after asking", async () => {
    const { unmount } = setup({ base: FIGURE, draft: draftFromRecord(FIGURE) });
    await userEvent.click(screen.getByRole("button", { name: copy.turnOff }));
    expect(deleteRecord).toHaveBeenCalledWith("paper-structure", "paper.figure");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    unmount();
    setup({ base: RTAB, draft: draftFromRecord(RTAB) });
    await userEvent.click(screen.getByRole("button", { name: copy.delete }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete Results table?");
    await userEvent.click(within(dialog).getByRole("button", { name: copy.deleteDialog.action }));
    expect(deleteRecord).toHaveBeenLastCalledWith("my-snippets", "user.rtab");
  });

  it("keeps the form open with the reason when saving or deleting fails", async () => {
    saveRecord.mockRejectedValueOnce(new Error("my-snippets.json has problems to fix before it can be changed here"));
    deleteRecord.mockRejectedValueOnce(new Error("Read-only folder"));
    setup({ base: RTAB, draft: draftFromRecord(RTAB) });
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByText(/has problems to fix/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.delete }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy.deleteDialog.action }));
    expect(await screen.findByText("Read-only folder")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("duplicates a snippet into My snippets under a new name", async () => {
    setup({ base: FIGURE, draft: draftFromRecord(FIGURE) });
    await userEvent.click(screen.getByRole("button", { name: copy.duplicate }));
    expect(screen.getByLabelText(copy.name)).toHaveValue("Figure copy");
    expect(screen.queryByRole("button", { name: copy.duplicate })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: copy.save }));
    const [collection, record] = saved();
    expect(collection).toBe("my-snippets");
    expect(record).toMatchObject({ id: "user.figure-copy", name: "Figure copy", layer: "user", trigger: "fig" });
  });

  it("cancels the delete question", async () => {
    setup({ base: RTAB, draft: draftFromRecord(RTAB) });
    await userEvent.click(screen.getByRole("button", { name: copy.delete }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Cancel/u }));
    expect(deleteRecord).not.toHaveBeenCalled();
  });
});
