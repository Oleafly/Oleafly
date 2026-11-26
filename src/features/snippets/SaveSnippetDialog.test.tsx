// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { buildLibrary, parseSnippetFile, type SnippetRecord, serializeBody } from "@oleafly/snippets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

import { SaveSnippetDialog } from "./SaveSnippetDialog";
import { useSaveSnippetDialog } from "./save-dialog";
import { useSnippetStore } from "./store";

const copy = enShell.snippets.save;
const initial = useSnippetStore.getState();
const saveRecord = vi.fn(async (_collection: string, _record: SnippetRecord) => undefined);

const BOOKTABS = [
  "\\begin{table}[t]\\centering",
  "\\caption{Field evaluation results.}\\label{tab:results}",
  "\\begin{tabular}{@{}lrrr@{}}\\toprule",
  "Method & Recall & FA/wk & Latency \\\\\\midrule",
  "Periodic stream & .957 & 1.8 & 72 s \\\\",
  "\\bottomrule",
  "\\end{tabular}",
  "\\end{table}",
].join("\n");

const TAKEN = parseSnippetFile(
  JSON.stringify({ "user.results-table": { name: "Results table", prefix: "rt", body: "x" } }),
  "my-snippets",
  "user",
);

function open(text = BOOKTABS, language: "latex" | null = "latex") {
  act(() => useSaveSnippetDialog.setState({ selection: { text, language, place: language ? "text" : "any" } }));
}

function preview(): string {
  const editor = screen.getByTestId("save-snippet-preview").querySelector(".cm-editor");
  return editor ? (EditorView.findFromDOM(editor as HTMLElement)?.state.doc.toString() ?? "") : "";
}

function field(name: RegExp) {
  return screen.getByRole("checkbox", { name });
}

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  const files = [TAKEN];
  useSnippetStore.setState({
    status: "ready",
    files,
    library: buildLibrary({ files, disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }),
    disk: [
      { name: "my-snippets.json", modifiedMs: 1, text: "{}", parsed: TAKEN, good: TAKEN },
      { name: "lab.json", modifiedMs: 1, text: "{}", parsed: TAKEN, good: TAKEN },
    ],
    saveRecord,
  });
  render(<SaveSnippetDialog />);
});

afterEach(() => {
  useSaveSnippetDialog.setState({ selection: null });
  useSnippetStore.setState(initial, true);
});

describe("SaveSnippetDialog", () => {
  it("stays closed until a selection is saved", () => {
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(screen.getByRole("dialog", { name: copy.title })).toBeInTheDocument();
  });

  it("finds the fields in a booktabs table and ticks the caption, label and column spec", () => {
    open();
    expect(screen.getByText("4 found")).toBeInTheDocument();
    expect(field(/Field evaluation results\./u)).toBeChecked();
    expect(field(/results.*follows the caption/u)).toBeChecked();
    expect(field(/@\{\}lrrr@\{\}/u)).toBeChecked();
    expect(field(/Method & Recall/u)).not.toBeChecked();
    expect(screen.getByText("LaTeX")).toBeInTheDocument();
    expect(screen.getByText(enShell.snippets.places.text)).toBeInTheDocument();
    expect(preview()).toContain(`\\caption{\${1:Field evaluation results.}}\\label{tab:\${1/slug}}`);
    expect(preview()).toContain(`\\begin{tabular}{\${2:@{\\}lrrr@{\\}}}`);
    expect(preview().endsWith("$0")).toBe(true);
  });

  it("drops the slug mirror when the label is unticked and adds the table body when it is ticked", async () => {
    open();
    await userEvent.click(field(/follows the caption/u));
    expect(preview()).toContain("\\label{tab:results}");
    expect(preview()).not.toContain("/slug");
    await userEvent.click(field(/Method & Recall/u));
    expect(preview()).toContain("${3:Method & Recall");
  });

  it("saves the previewed body with the name, trigger and expand mode", async () => {
    open();
    await userEvent.type(screen.getByLabelText(copy.name), "Results table");
    await userEvent.type(screen.getByLabelText(copy.trigger), "rtab");
    await userEvent.click(screen.getByRole("button", { name: enShell.snippets.expands.list }));
    const body = preview();
    await userEvent.click(screen.getByRole("button", { name: copy.submit }));
    const [collection, record] = saveRecord.mock.calls[0];
    expect(collection).toBe("my-snippets");
    expect(record).toMatchObject({ id: "user.results-table-2", name: "Results table", trigger: "rtab", expand: "list", place: "text", languages: ["latex"] });
    expect(serializeBody(record.bodies.default ?? [])).toBe(body);
    expect(mocks.toast.success).toHaveBeenCalledWith("Saved Results table.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves into another of your collections", async () => {
    open();
    await userEvent.type(screen.getByLabelText(copy.name), "Lab table");
    await userEvent.click(screen.getByRole("combobox", { name: copy.saveTo }));
    await userEvent.click(await screen.findByRole("option", { name: "lab" }));
    await userEvent.click(screen.getByRole("button", { name: copy.submit }));
    expect(saveRecord.mock.calls[0][0]).toBe("lab");
  });

  it("asks for a name, and keeps the dialog open with the reason when saving fails", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: copy.submit }));
    expect(screen.getByText(copy.missingName)).toBeInTheDocument();
    expect(saveRecord).not.toHaveBeenCalled();
    saveRecord.mockRejectedValueOnce(new Error("my-snippets.json has problems to fix before it can be changed here"));
    await userEvent.type(screen.getByLabelText(copy.name), "Table");
    await userEvent.click(screen.getByRole("button", { name: copy.submit }));
    expect(await screen.findByText(/has problems to fix/u)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no fields outside a snippet language and closes on Cancel", async () => {
    open("plain words here", null);
    expect(screen.getByText(copy.noFields)).toBeInTheDocument();
    expect(screen.getByText(enShell.snippets.languages.any)).toBeInTheDocument();
    expect(preview()).toBe("plain words here$0");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(useSaveSnippetDialog.getState().selection).toBeNull();
  });
});
