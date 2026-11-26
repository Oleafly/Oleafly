// @vitest-environment jsdom

import { autocompletion, type CompletionSource, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteChange } from "../collaboration";
import {
  acceptGhostSuggestion,
  type GhostRequest,
  ghostCompletion,
  pendingGhostCompletion,
  requestedGhostCompletion,
} from "../ghost-completion";
import { latexLanguage } from "../latex";
import { tabOrderKeymap } from "../tab-order";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { snippetGhostHint, snippetHintBlocksAi } from "./hint";
import { insertSnippet } from "./insert";
import { loadSnippetRuntime } from "./loader";
import type { SnippetPort } from "./port";
import { snippetSessions } from "./session";
import { destroyViews, portWith, press, snippetEditor, type } from "./tests/editor";
import { PAPER_ENTRIES } from "./tests/fixtures";

stubRangeGeometry();

const HINT_ENTRIES = {
  "paper.figure": PAPER_ENTRIES["paper.figure"],
  "paper.theorem": PAPER_ENTRIES["paper.theorem"],
  "paper.table": PAPER_ENTRIES["paper.table"],
  "paper.figref": { ...PAPER_ENTRIES["paper.figref"], prefix: "fref" },
};

interface Call {
  request: GhostRequest;
  resolve: () => void;
}

const calls: Call[] = [];

function request(input: GhostRequest): Promise<void> {
  return new Promise<void>((resolve) => calls.push({ request: input, resolve }));
}

const switches = (hint: boolean) => () => ({ list: true, tab: true, auto: true, hint });

interface Options {
  port?: Partial<SnippetPort>;
  ai?: boolean;
  popup?: CompletionSource;
}

function hintEditor(marked: string, options: Options = {}): EditorView {
  return snippetEditor(marked, {
    port: portWith(HINT_ENTRIES, options.port),
    extensions: [
      latexLanguage(),
      ghostCompletion([], "latex", snippetGhostHint()),
      ...(options.ai ? [requestedGhostCompletion(request, { delayMs: 50 })] : []),
      ...(options.popup ? [autocompletion({ override: [options.popup], activateOnTyping: false, interactionDelay: 0 })] : []),
      tabOrderKeymap(),
    ],
  });
}

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await Promise.resolve();
}

function chip(view: EditorView): string | null {
  return view.dom.querySelector(".cm-ghostSnippet")?.textContent ?? null;
}

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

describe("snippet hints", () => {
  it("shows the rest of a unique trigger and the snippet name", async () => {
    const view = type(hintEditor("|"), "fi");
    await flush();
    expect(pendingGhostCompletion(view)).toBe("g");
    expect(view.dom.querySelector(".cm-ghostCompletion")?.textContent).toBe("g");
    expect(chip(view)).toBe("⇥ Figure");
  });

  it("shows the chip alone for a fully typed trigger", async () => {
    const view = type(hintEditor("|"), "fig");
    await flush();
    expect(pendingGhostCompletion(view)).toBe("");
    expect(view.dom.querySelector(".cm-ghostCompletion")).toBeNull();
    expect(chip(view)).toBe("⇥ Figure");
  });

  it("inserts the snippet with its fields on Tab", async () => {
    const recordUse = vi.fn();
    const view = type(hintEditor("|", { port: { recordUse } }), "fi");
    await flush();
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("\\begin{figure}[htbp]\n  \\caption{Caption}\n\\end{figure}");
    expect(snippetSessions(view.state)).toHaveLength(1);
    expect(recordUse).toHaveBeenCalledWith("paper.figure");
  });

  it("does not hint a start-of-line snippet in the middle of a sentence", async () => {
    const view = type(hintEditor("The |"), "fi");
    await flush();
    expect(pendingGhostCompletion(view)).toBeNull();
  });

  it("hints the shortest shared trigger, but not a list-only snippet, diverging triggers, or while the switch is off", async () => {
    const list = type(hintEditor("|"), "fref");
    await flush();
    expect(pendingGhostCompletion(list)).toBeNull();
    const paper = type(hintEditor("|", { port: { library: () => portWith(PAPER_ENTRIES).library() } }), "fi");
    await flush();
    expect(pendingGhostCompletion(paper)).toBe("g");
    const diverging = {
      "a.fiat": { name: "Fiat", prefix: "fiat", body: "a", expand: "tab", where: "text" },
      "a.fig": { name: "Fig", prefix: "fig", body: "b", expand: "tab", where: "text" },
    };
    const ambiguous = type(hintEditor("|", { port: { library: () => portWith(diverging).library() } }), "fi");
    await flush();
    expect(pendingGhostCompletion(ambiguous)).toBeNull();
    const off = type(hintEditor("|", { port: { enabled: switches(false) } }), "fi");
    await flush();
    expect(pendingGhostCompletion(off)).toBeNull();
  });

  it("does not hint inside a field Tab would leave", async () => {
    const port = portWith(HINT_ENTRIES);
    const view = snippetEditor("|", {
      port,
      extensions: [latexLanguage(), ghostCompletion([], "latex", snippetGhostHint()), tabOrderKeymap()],
    });
    insertSnippet(view, port.library().byId("paper.theorem") as never, 0, 0, "list");
    type(view, "thm");
    await flush();
    expect(pendingGhostCompletion(view)).toBeNull();
  });

  it("does not hint with several cursors or in a read-only editor", async () => {
    const cursors = hintEditor("|\n|");
    type(cursors, "f");
    await flush();
    expect(snippetGhostHint()(cursors.state)).toBeNull();
    expect(snippetHintBlocksAi(cursors.state)).toBe(false);
    const view = type(hintEditor("|"), "fi");
    Object.defineProperty(view.state, "readOnly", { get: () => true });
    expect(snippetGhostHint()(view.state)).toBeNull();
  });

  it("stays hidden while the completion popup is open", async () => {
    const popup: CompletionSource = (context) => ({ from: context.pos, options: [{ label: "x" }] });
    const view = type(hintEditor("|", { popup }), "fi");
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await flush();
    expect(pendingGhostCompletion(view)).toBeNull();
  });

  it("hides on Escape until the next space, then lets AI ask", async () => {
    const view = type(hintEditor("Notes\n|", { ai: true }), "th");
    await flush();
    expect(chip(view)).toBe("⇥ Theorem");
    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(0);
    press(view, "Escape");
    await flush();
    expect(chip(view)).toBeNull();
    expect(calls).toHaveLength(1);
    type(view, "m");
    await flush();
    expect(chip(view)).toBeNull();
    type(view, " th");
    await flush();
    expect(chip(view)).toBe("⇥ Theorem");
  });

  it("asks AI once on Escape, not again for each remote edit before the caret", async () => {
    const view = type(hintEditor("Notes\n|", { ai: true }), "th");
    await flush();
    press(view, "Escape");
    await flush();
    expect(calls).toHaveLength(1);
    for (let round = 0; round < 2; round += 1) {
      view.dispatch({ changes: { from: 0, insert: "x" }, annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)] });
      await flush();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].request.signal.aborted).toBe(true);
  });

  it("clears the dismissal when the caret jumps", async () => {
    const view = type(hintEditor("|"), "fig");
    await flush();
    press(view, "Escape");
    await flush();
    expect(chip(view)).toBeNull();
    view.dispatch({ selection: EditorSelection.cursor(1) });
    view.dispatch({ selection: EditorSelection.cursor(3) });
    await flush();
    expect(chip(view)).toBe("⇥ Figure");
  });

  it("replaces an AI suggestion and cancels its request", async () => {
    const view = type(hintEditor("Intro\n|", { ai: true }), "t");
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(1);
    calls[0].request.onText("hm is");
    await flush();
    expect(pendingGhostCompletion(view)).toBe("hm");
    type(view, "h");
    await flush();
    expect(pendingGhostCompletion(view)).toBe("m");
    expect(chip(view)).toBe("⇥ Theorem");
    expect(calls[0].request.signal.aborted).toBe(true);
    calls[0].request.onText("hm is true");
    calls[0].resolve();
    await flush();
    expect(chip(view)).toBe("⇥ Theorem");
  });

  it("keeps an AI suggestion that a start-of-line snippet cannot replace", async () => {
    const view = type(hintEditor("The |", { ai: true }), "t");
    vi.advanceTimersByTime(50);
    calls[0].request.onText("able shows the trend.");
    calls[0].resolve();
    await flush();
    expect(pendingGhostCompletion(view)).toBe("able shows the trend.");
    type(view, "a");
    await flush();
    expect(pendingGhostCompletion(view)).toBe("ble shows the trend.");
    expect(acceptGhostSuggestion(view, "snippet")).toBe(false);
  });

  it("never asks AI while an exact Tab trigger sits at the caret, even with hints off", async () => {
    const view = type(hintEditor("Notes\n|", { ai: true, port: { enabled: switches(false) } }), "fig");
    vi.advanceTimersByTime(200);
    await flush();
    expect(calls).toHaveLength(0);
    type(view, "x");
    vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(1);
  });

  it("asks AI as before when nothing could fire", async () => {
    const view = type(hintEditor("Notes\n|", { ai: true, port: { enabled: switches(false) } }), "fi");
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(1);
    expect(snippetHintBlocksAi(view.state)).toBe(false);
  });

  it("hints nothing without a language", async () => {
    const view = type(hintEditor("|", { port: { language: () => null } }), "fi");
    await flush();
    expect(pendingGhostCompletion(view)).toBeNull();
    expect(snippetHintBlocksAi(view.state)).toBe(false);
  });

  it("clears the dismissal when typing moves before the word", async () => {
    const view = type(hintEditor("Notes\n|"), "th");
    await flush();
    press(view, "Escape");
    for (let round = 0; round < 3; round += 1) {
      view.dispatch({
        changes: { from: view.state.selection.main.head - 1, to: view.state.selection.main.head },
        userEvent: "delete.backward",
      });
    }
    type(view, "\nth");
    await flush();
    expect(chip(view)).toBe("⇥ Theorem");
  });

  it("reports a slow Tab trigger pattern while checking whether AI may ask", () => {
    const reportSlowRegex = vi.fn();
    const view = hintEditor("|", {
      port: {
        reportSlowRegex,
        library: () =>
          portWith({ times: { prefix: "re:(\\d)x", body: "[[0]] \\times", expand: "tab", where: "text", languages: ["latex"] } }).library(),
      },
    });
    type(view, "3x");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5));
    expect(snippetHintBlocksAi(view.state)).toBe(true);
    vi.restoreAllMocks();
    expect(reportSlowRegex).toHaveBeenCalled();
  });

  it("declines to accept a hint whose snippet is gone", async () => {
    let entries: Record<string, unknown> = HINT_ENTRIES;
    const view = type(hintEditor("|", { port: { library: () => portWith(entries).library() } }), "fi");
    await flush();
    entries = {};
    expect(acceptGhostSuggestion(view, "snippet")).toBe(false);
    expect(acceptGhostSuggestion(view, "ai-or-word")).toBe(false);
  });
});
