// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { parseSnippetFile, type SnippetRecord } from "@oleafly/snippets";
import { describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

vi.mock("@/features/snippets/port", () => ({
  createSnippetPort: (getPath: () => string | null) => ({
    filePath: getPath,
    projectName: () => null,
    typstVersion: () => undefined,
    projectItems: () => [],
    useCount: () => 0,
    readClipboard: async () => "",
  }),
}));

import { SnippetTryIt } from "./SnippetTryIt";

const copy = enSettings.snippets.editor.tryIt;

function record(entry: Record<string, unknown>): SnippetRecord {
  const parsed = parseSnippetFile(JSON.stringify({ "mine.try": { name: "Try", ...entry } }), "mine", "user");
  const [found] = parsed.records;
  if (!found) throw new Error(JSON.stringify(parsed.problems));
  return found;
}

function editorView(): EditorView {
  const host = within(screen.getByTestId("snippet-try-it-editor")).getByRole("textbox");
  const view = EditorView.findFromDOM(host);
  if (!view) throw new Error("no editor");
  return view;
}

function type(view: EditorView, text: string): void {
  for (const character of text) {
    const at = view.state.selection.main.head;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, at, at, character, () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: "input.type" })));
    if (!handled) view.dispatch({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: "input.type" });
  }
}

function pressTab(view: EditorView): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
}

describe("SnippetTryIt", () => {
  it("expands a Tab snippet with the real engine and says where it fires", () => {
    render(<SnippetTryIt record={record({ prefix: "fig", body: "\\begin{figure}$1\\end{figure}", where: "text" })} languages={["latex"]} />);
    expect(screen.getByText(copy.howTab.replace("{{trigger}}", "fig"))).toBeTruthy();
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain("LaTeX");
    const view = editorView();
    type(view, "fig");
    pressTab(view);
    expect(view.state.doc.toString()).toBe("\\begin{figure}\\end{figure}");
  });

  it("expands an As you type snippet inside math", async () => {
    const user = userEvent.setup();
    render(<SnippetTryIt record={record({ prefix: "//", body: "\\frac{$1}{$2}", expand: "auto", where: "math", inWord: true })} languages={["latex"]} />);
    expect(screen.getByText(copy.howAuto.replace("{{trigger}}", "//"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: copy.inMath }));
    const view = editorView();
    expect(view.state.doc.toString()).toBe("$$");
    expect(view.state.selection.main.head).toBe(1);
    type(view, "//");
    expect(view.state.doc.toString()).toBe("$\\frac{}{}$");
  });

  it("explains when the place or the language does not fit", async () => {
    const user = userEvent.setup();
    const textOnly = record({ prefix: "fig", body: "x", where: "text", languages: ["latex", "typst"] });
    const { unmount } = render(<SnippetTryIt record={textOnly} languages={["latex", "typst"]} />);
    await user.click(screen.getByRole("button", { name: copy.inMath }));
    expect(screen.getByTestId("snippet-try-it-blocked").textContent).toBe(copy.notPlace.replace("{{place}}", copy.inMath));
    await user.click(screen.getByRole("button", { name: "Typst" }));
    expect(screen.getByTestId("snippet-try-it-blocked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: copy.inText }));
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain("Typst");
    unmount();

    render(<SnippetTryIt record={record({ prefix: "ref", body: "x", languages: ["typst"] })} languages={["latex"]} />);
    expect(screen.getByTestId("snippet-try-it-blocked").textContent).toBe(copy.notLanguage.replace("{{language}}", "LaTeX"));
  });

  it("describes list snippets, snippets without a trigger, and BibTeX without a math choice", () => {
    const { unmount } = render(<SnippetTryIt record={record({ prefix: "cite", body: "x", expand: "list" })} languages={["latex"]} />);
    expect(screen.getByText(copy.howList.replace("{{trigger}}", "cite"))).toBeTruthy();
    unmount();
    const { unmount: second } = render(<SnippetTryIt record={record({ body: "x" })} languages={["latex"]} />);
    expect(screen.getByText(copy.noTrigger)).toBeTruthy();
    second();
    render(<SnippetTryIt record={record({ prefix: "art", body: "@article{$1}" })} languages={["bibtex"]} />);
    expect(screen.queryByRole("button", { name: copy.inMath })).toBeNull();
    expect(screen.getByTestId("snippet-try-it-fires")).toBeTruthy();
  });

  it("starts in text unless the snippet only fires in math", () => {
    const { unmount } = render(<SnippetTryIt record={record({ prefix: "tab", body: "x" })} languages={["latex"]} />);
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain(copy.inText);
    unmount();
    render(<SnippetTryIt record={record({ prefix: "sq", body: "^2", where: "math" })} languages={["latex"]} />);
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain(copy.inMath);
  });

  it("falls back to the first language when the chosen one is no longer offered", () => {
    const fig = record({ prefix: "fig", body: "x" });
    const { rerender } = render(<SnippetTryIt record={fig} languages={["latex", "typst"]} />);
    rerender(<SnippetTryIt record={fig} languages={["markdown"]} />);
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain("Markdown");
    rerender(<SnippetTryIt record={fig} languages={[]} />);
    expect(screen.getByTestId("snippet-try-it-fires").textContent).toContain("LaTeX");
  });

  it("starts over with the snippet as it is now when whole word, start of line, the pattern, languages or aliases change", () => {
    const changes: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ inWord: false }, { inWord: true }],
      [{ lineStart: false }, { lineStart: true }],
      [{ prefix: "ab" }, { prefix: "re:ab" }],
      [{ languages: ["latex"] }, { languages: ["latex", "typst"] }],
      [{ prefix: "ab" }, { prefix: ["ab", "abc"] }],
    ];
    for (const [before, after] of changes) {
      const { rerender, unmount } = render(<SnippetTryIt record={record({ prefix: "ab", body: "X", where: "text", ...before })} languages={["latex"]} />);
      type(editorView(), "q");
      rerender(<SnippetTryIt record={record({ prefix: "ab", body: "X", where: "text", ...after })} languages={["latex"]} />);
      expect(editorView().state.doc.toString()).toBe("");
      unmount();
    }
    const { rerender } = render(<SnippetTryIt record={record({ prefix: "fig", body: "FIG", where: "text", inWord: false })} languages={["latex"]} />);
    type(editorView(), "afig");
    pressTab(editorView());
    expect(editorView().state.doc.toString()).toBe("afig");
    rerender(<SnippetTryIt record={record({ prefix: "fig", body: "FIG", where: "text", inWord: true })} languages={["latex"]} />);
    type(editorView(), "afig");
    pressTab(editorView());
    expect(editorView().state.doc.toString()).toBe("aFIG");
  });

  it("tries a display math snippet inside display math", () => {
    const square = record({ prefix: "sq", body: "^2", expand: "tab", where: "display-math", languages: ["latex", "typst", "markdown"] });
    render(<SnippetTryIt record={square} languages={["latex", "typst", "markdown"]} />);
    const samples: [string, string, string][] = [
      ["LaTeX", "\\[\\]", "\\[^2\\]"],
      ["Typst", "$  $", "$ ^2 $"],
      ["Markdown", "$$$$", "$$^2$$"],
    ];
    for (const [language, sample, expanded] of samples) {
      fireEvent.click(screen.getByRole("button", { name: language }));
      const view = editorView();
      expect(view.state.doc.toString()).toBe(sample);
      expect(view.state.selection.main.head).toBe(2);
      type(view, "sq");
      pressTab(view);
      expect(view.state.doc.toString()).toBe(expanded);
      expect(screen.getByTestId("snippet-try-it-fires")).toBeTruthy();
    }
  });
});
