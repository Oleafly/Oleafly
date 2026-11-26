// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { buildLibrary, parseSnippetFile, type SnippetRecord } from "@oleafly/snippets";
import { afterEach, describe, expect, it, vi } from "vitest";

const tried = vi.hoisted(() => [] as (SnippetRecord | null)[]);

vi.mock("./SnippetTryIt", () => ({
  SnippetTryIt: ({ record }: Readonly<{ record: SnippetRecord }>) => {
    tried.push(record);
    return null;
  },
}));

import { draftFromRecord } from "@/features/snippets/draft";
import { useSnippetStore } from "@/features/snippets/store";
import { SnippetEditor } from "./SnippetEditor";

const initial = useSnippetStore.getState();
const MINE = parseSnippetFile(
  JSON.stringify({ "user.rtab": { name: "Results table", prefix: "rtab", body: "\\begin{table}$1\\end{table}", languages: ["latex"] } }),
  "my-snippets",
  "user",
);
const RTAB = MINE.records[0];

afterEach(() => {
  useSnippetStore.setState(initial, true);
  tried.length = 0;
});

describe("SnippetEditor while typing", () => {
  it("hands Try it the new snippet a render later, so a keystroke in the body never waits for it", () => {
    useSnippetStore.setState({
      files: [MINE],
      library: buildLibrary({ files: [MINE], disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }),
      disk: [{ name: "my-snippets.json", modifiedMs: 1, text: "{}", parsed: MINE, good: MINE }],
    });
    render(<SnippetEditor start={{ base: RTAB, draft: draftFromRecord(RTAB) }} onClose={vi.fn()} />);
    const editor = screen.getByTestId("snippet-body").querySelector(".cm-editor");
    const view = editor ? EditorView.findFromDOM(editor as HTMLElement) : null;
    if (!view) throw new Error("no body editor");
    const shown = tried.at(-1);
    const before = tried.length;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "%" } }));
    const renders = tried.slice(before);
    expect(renders.length).toBeGreaterThan(1);
    expect(renders[0]).toBe(shown);
    expect(renders.at(-1)).not.toBe(shown);
  });
});
