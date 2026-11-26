// @vitest-environment jsdom

import {
  autocompletion,
  type CompletionSource,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
} from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type GhostRequest, ghostCompletion, pendingGhostCompletion, requestedGhostCompletion } from "./ghost-completion";
import { latexLanguage } from "./latex";
import { snippetAutoExpand } from "./snippets/auto";
import { loadSnippetRuntime, withSnippetCompletions } from "./snippets/loader";
import { snippetGhostHint } from "./snippets/hint";
import { insertSnippet } from "./snippets/insert";
import type { SnippetPort } from "./snippets/port";
import { activeSnippetField, snippetSessions } from "./snippets/session";
import { destroyViews, portWith, press, snippetEditor, type, withCursor } from "./snippets/tests/editor";
import { FAST_MATH_ENTRIES, PAPER_ENTRIES } from "./snippets/tests/fixtures";
import { expandTabTrigger } from "./snippets/tab";
import { runTabOrder, tabOrderKeymap } from "./tab-order";
import { stubRangeGeometry } from "./test-geometry";
import { installEnglishEditorMessages } from "./test-messages";

stubRangeGeometry();

const ENTRIES = {
  ...FAST_MATH_ENTRIES,
  "paper.figure": PAPER_ENTRIES["paper.figure"],
  "paper.theorem": PAPER_ENTRIES["paper.theorem"],
};

const calls: GhostRequest[] = [];
const hintsOff = () => ({ list: true, tab: true, auto: true, hint: false });

interface Options {
  port?: Partial<SnippetPort>;
  popup?: CompletionSource[];
  extensions?: Extension[];
}

function editor(marked: string, options: Options = {}): EditorView {
  return snippetEditor(marked, {
    port: portWith(ENTRIES, options.port),
    extensions: [
      latexLanguage(),
      snippetAutoExpand(),
      ghostCompletion([], "latex", snippetGhostHint()),
      requestedGhostCompletion(
        (request) =>
          new Promise<void>(() => {
            calls.push(request);
          }),
        { delayMs: 50 },
      ),
      autocompletion({
        override: withSnippetCompletions(options.popup ?? []),
        activateOnTyping: false,
        interactionDelay: 0,
      }),
      ...(options.extensions ?? []),
      tabOrderKeymap(),
      keymap.of([indentWithTab]),
    ],
  });
}

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await Promise.resolve();
}

const words: CompletionSource = (context) => {
  const word = context.matchBefore(/\w+$/u);
  return word ? { from: word.from, options: [{ label: "alpha" }, { label: "alphabet" }, { label: "alps" }] } : null;
};

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadSnippetRuntime();
});

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  destroyViews();
  vi.useRealTimers();
});

describe("the Tab order", () => {
  it("moves to the next field of the active session first", () => {
    const view = type(editor("$|$"), "//");
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{}{|}$");
    press(view, "Tab", true);
    expect(withCursor(view)).toBe("$\\frac{|}{}$");
  });

  it("returns to the outer snippet after an inner one ends", () => {
    const view = type(editor("$|$"), "//");
    type(view, "sum");
    expect(snippetSessions(view.state)).toHaveLength(2);
    press(view, "Tab");
    press(view, "Tab");
    expect(snippetSessions(view.state)).toHaveLength(1);
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{\\sum_{i=1}^{n} }{|}$");
  });

  it("accepts a choice from the popup inside a choice field", async () => {
    const port = portWith(ENTRIES);
    const view = editor("fig|");
    insertSnippet(view, port.library().byId("paper.figure") as never, 0, 3, "tab");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    moveCompletionSelection(true)(view);
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toContain("\\begin{figure}[t]");
    expect(activeSnippetField(view.state)?.choices).toBeDefined();
  });

  it("accepts the popup inside a plain field once its selection moved, and moves on otherwise", async () => {
    const view = editor("|", { popup: [words] });
    insertSnippet(view, portWith(ENTRIES).library().byId("paper.theorem") as never, 0, 0, "list");
    type(view, "al");
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    moveCompletionSelection(true)(view);
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("\\begin{theorem}\n  alphabet\n\\end{theorem}");

    const plain = editor("|", { popup: [words] });
    insertSnippet(plain, portWith(ENTRIES).library().byId("paper.theorem") as never, 0, 0, "list");
    type(plain, "al");
    startCompletion(plain);
    await vi.waitFor(() => expect(completionStatus(plain.state)).toBe("active"));
    press(plain, "Tab");
    expect(withCursor(plain)).toBe("\\begin{theorem}\n  al\n\\end{theorem}|");
  });

  it("accepts the completion popup outside a session", async () => {
    const view = type(editor("|", { popup: [words] }), "alp");
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("alpha");
  });

  it("inserts a snippet hint before an exact trigger", async () => {
    const view = type(editor("|"), "th");
    await flush();
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("\\begin{theorem}\n  \n\\end{theorem}");
  });

  it("expands an exact trigger ahead of an AI suggestion when hints are off", async () => {
    const view = type(editor("Notes\n|", { port: { enabled: hintsOff } }), "th");
    vi.advanceTimersByTime(50);
    calls[0].onText("m and more");
    await flush();
    type(view, "m");
    await flush();
    expect(pendingGhostCompletion(view)).toBe(" and");
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("Notes\n\\begin{theorem}\n  \n\\end{theorem}");
  });

  it("accepts an AI suggestion when nothing else applies", async () => {
    const view = type(editor("Notes\n|"), "q");
    vi.advanceTimersByTime(50);
    calls[0].onText("uickly done");
    await flush();
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("Notes\nquickly");
  });

  it("falls through to indentation when nothing matches", () => {
    const view = editor("plain|");
    expect(runTabOrder(view)).toBe(false);
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("  plain");
    expect(press(view, "Tab", true)).toBe(true);
  });

  it("expands a regular-expression Tab trigger and reports a slow one", () => {
    const reportSlowRegex = vi.fn();
    const port = portWith(
      { times: { prefix: "re:(\\d)x", body: "[[0]] \\times", expand: "tab", where: "text", languages: ["latex"] } },
      { reportSlowRegex },
    );
    const view = snippetEditor("3x|", { port, extensions: [latexLanguage()] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5));
    expect(expandTabTrigger(view)).toBe(true);
    vi.restoreAllMocks();
    expect(view.state.doc.toString()).toBe("3 \\times");
    expect(reportSlowRegex).toHaveBeenCalled();
  });

  it("expands a Tab trigger at every cursor", () => {
    const view = editor("thm|\nthm|");
    expect(expandTabTrigger(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\begin{theorem}\n  \n\\end{theorem}\n\\begin{theorem}\n  \n\\end{theorem}");
  });

  it("expands in vim insert mode and leaves vim normal mode alone", () => {
    const insert = editor("thm|", { port: { enabled: hintsOff } });
    Object.assign(insert, { cm: { state: { vim: { insertMode: true } } } });
    expect(runTabOrder(insert)).toBe(true);
    const normal = editor("thm|", { port: { enabled: hintsOff } });
    Object.assign(normal, { cm: { state: { vim: { insertMode: false } } } });
    expect(runTabOrder(normal)).toBe(false);
    expect(expandTabTrigger(normal)).toBe(false);
    expect(normal.state.doc.toString()).toBe("thm");
  });

  it("does not expand with the Tab switch off, a selection, or a read-only editor", () => {
    expect(expandTabTrigger(editor("thm|", { port: { enabled: () => ({ list: true, tab: false, auto: true, hint: true }) } }))).toBe(false);
    const selected = editor("thm|");
    selected.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(expandTabTrigger(selected)).toBe(false);
    const locked = editor("thm|");
    Object.defineProperty(locked.state, "readOnly", { get: () => true });
    expect(expandTabTrigger(locked)).toBe(false);
    expect(expandTabTrigger(editor("$thm|$"))).toBe(false);
  });
});
