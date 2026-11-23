// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  autocompletion,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  acceptGhostCompletion,
  clearGhostCompletion,
  ghostCompletion,
  pendingGhostCompletion,
  requestedGhostCompletion,
} from "./ghost-completion";
import { latexCompletions } from "./latex";

function sourceOf(
  labels: Array<string | { label: string; boost?: number; apply?: unknown }>,
): CompletionSource {
  return (context) => {
    const match = context.matchBefore(/(\\[a-zA-Z@]*|[A-Za-z][A-Za-z0-9]*)$/);
    if (!match) return null;
    return {
      from: match.from,
      options: labels.map((entry) =>
        typeof entry === "string" ? { label: entry } : entry,
      ) as never,
    };
  };
}

// jsdom has no layout, but the ghost only needs the state field and the view
// plugin, both of which run headless.
function mount(
  doc: string,
  sources: CompletionSource[],
  selection = 0,
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [ghostCompletion(sources)],
    }),
    parent: document.body,
  });
  view.focus();
  return view;
}

function caretToEnd(view: EditorView) {
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}

const settle = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

describe("ghost completion suggestions", () => {
  it("does not materialize a large prose document for a non-trigger token", async () => {
    const doc = `${"ordinary prose ".repeat(100_000)}typing`;
    const source = vi.fn<CompletionSource>((context) => {
      context.state.doc.toString();
      return null;
    });
    const view = mount(doc, [source], doc.length);
    const sliceString = vi.spyOn(view.state.doc, "sliceString");
    const toString = vi.spyOn(view.state.doc, "toString");

    await settle();

    expect(source).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
    expect(
      sliceString.mock.calls.every(([from = 0, to = view.state.doc.length]) =>
        to - from <= 2_048
      ),
    ).toBe(true);
    view.destroy();
  });

  it("offers the remainder of the best matching command", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha", "\\alphabet"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("prefers a higher boost over a shorter label", async () => {
    const view = mount("\\alp", [
      sourceOf([
        { label: "\\alpha" },
        { label: "\\alphabetical", boost: 50 },
      ]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("habetical");
    view.destroy();
  });

  it("stays quiet until enough characters are typed", async () => {
    const view = mount("\\a", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "l" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("pha");
    view.destroy();
  });

  it("needs three characters after an at-reference trigger", async () => {
    const view = mount("@se", [sourceOf(["section"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "c" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("tion");
    view.destroy();
  });

  it("previews the label even when apply is a guarded function", async () => {
    const view = mount("\\sec", [
      sourceOf([{ label: "\\section", apply: () => undefined }]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("tion");
    view.destroy();
  });

  it("previews a string apply rather than the label", async () => {
    const view = mount("\\ite", [
      sourceOf([{ label: "\\item", apply: "\\item " }]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("m ");
    view.destroy();
  });

  it("does not suggest in the middle of a word", async () => {
    const view = mount("\\alpX", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 4 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("suggests when a closing brace follows the cursor", async () => {
    const view = mount("{\\alp}", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 5 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("stays quiet when nothing matches the typed prefix", async () => {
    const view = mount("\\zzz", [sourceOf(["\\alpha", "\\beta"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("ignores an exact match, which has nothing left to suggest", async () => {
    const view = mount("\\alpha", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("skips asynchronous sources and falls through to a sync one", async () => {
    const slow: CompletionSource = () => Promise.resolve(null);
    const view = mount("\\alp", [slow, sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("survives a source that throws", async () => {
    const broken: CompletionSource = () => {
      throw new Error("source failure");
    };
    const view = mount("\\alp", [broken, sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("does not run a queued source after the editor is destroyed", async () => {
    const source = vi.fn(sourceOf(["\\alpha"]));
    const view = mount("\\alp", [source]);
    source.mockClear();

    view.destroy();
    await settle();

    expect(source).not.toHaveBeenCalled();
  });

  it("clears the suggestion when the selection is not empty", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    view.dispatch({ selection: { anchor: 0, head: 4 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("tracks the highlighted option while the completion popup stays open", async () => {
    const source = sourceOf(["alpha", "alpine"]);
    const view = new EditorView({
      state: EditorState.create({
        doc: "alp",
        selection: { anchor: 3 },
        extensions: [
          ghostCompletion([source]),
          autocompletion({
            override: [source],
            activateOnTyping: false,
            interactionDelay: 0,
          }),
        ],
      }),
      parent: document.body,
    });

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    expect(moveCompletionSelection(true)(view)).toBe(true);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ine");
    view.destroy();
  });
});

describe("accepting and dismissing", () => {
  it("routes a Tab keydown through the editor keymap", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("\\alpha");
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("routes Tab to the highlighted completion while the popup is active", async () => {
    const source = sourceOf([
      { label: "\\alpha", apply: "\\alpha{}" },
      "\\alphabet",
    ]);
    const view = new EditorView({
      state: EditorState.create({
        doc: "\\alp",
        selection: { anchor: 4 },
        extensions: [
          ghostCompletion([source]),
          autocompletion({
            override: [source],
            activateOnTyping: false,
            interactionDelay: 0,
          }),
        ],
      }),
      parent: document.body,
    });
    view.focus();

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha{}");

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // The completion's apply value wins over its label, proving that Tab
    // delegates to CodeMirror instead of merely inserting the ghost text.
    expect(view.state.doc.toString()).toBe("\\alpha{}");
    expect(completionStatus(view.state)).toBeNull();
    view.destroy();
  });

  it("accepts the visible ghost when the popup refuses inside its interaction delay", async () => {
    const source = sourceOf(["\\alpha"]);
    const view = new EditorView({
      state: EditorState.create({
        doc: "\\alp",
        selection: { anchor: 4 },
        extensions: [
          ghostCompletion([source]),
          autocompletion({
            override: [source],
            activateOnTyping: false,
            interactionDelay: 10_000,
          }),
        ],
      }),
      parent: document.body,
    });
    view.focus();

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await settle();

    expect(acceptGhostCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\alpha");
    view.destroy();
  });

  it("Tab inserts the suggestion and leaves the cursor after it", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(acceptGhostCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\alpha");
    expect(view.state.selection.main.head).toBe(6);
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("declines when there is nothing to accept, so Tab keeps indenting", async () => {
    const view = mount("plain text", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(acceptGhostCompletion(view)).toBe(false);
    expect(clearGhostCompletion(view)).toBe(false);
    view.destroy();
  });

  it("Escape dismisses without changing the document", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(clearGhostCompletion(view)).toBe(true);
    expect(pendingGhostCompletion(view)).toBeNull();
    expect(view.state.doc.toString()).toBe("\\alp");
    view.destroy();
  });

  it("renders the suggestion as a dim widget in the document", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    const widget = view.dom.querySelector(".cm-ghostCompletion");
    expect(widget?.textContent).toBe("ha");
    expect(widget?.getAttribute("aria-hidden")).toBe("true");
    view.destroy();
  });
});

describe("dismissal", () => {
  it("stays dismissed at the same cursor, and returns after the next edit", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    clearGhostCompletion(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "h" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("a");
    view.destroy();
  });
});

describe("ghost prefix follows the source result", () => {
  async function ghostFor(
    doc: string,
    sources: CompletionSource[],
    syntax: "latex" | "markdown" | "typst",
  ): Promise<string | null> {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [ghostCompletion(sources, syntax)],
      }),
      parent: document.body,
    });
    await settle();
    const ghost = pendingGhostCompletion(view);
    view.destroy();
    return ghost;
  }

  function keySource(trigger: RegExp, labels: string[]): CompletionSource {
    return (context) => {
      const match = context.matchBefore(trigger);
      if (!match) return null;
      const key = /[\p{L}\p{M}\p{N}_:.+/-]*$/u.exec(match.text)?.[0] ?? "";
      return {
        from: context.pos - key.length,
        options: labels.map((label) => ({ label })),
      };
    };
  }

  it.each([
    ["\\label{fig:results-plot}\\label{results}\n\\ref{fig:res", "ults-plot"],
    ["\\label{k20x}\\label{Nov\u00E1k2020}\n\\ref{Nov\u00E1k20", "20"],
    ["\\label{\u00FAvodn\u00ED}\n\\ref{\u00FAvo", "dn\u00ED"],
    ["\\label{sec-intro}\n\\ref{sec-int", "ro"],
    ["\\label{intro}\n\\ref{int", "ro"],
  ])("completes %s from the reference argument", async (doc, ghost) => {
    expect(await ghostFor(doc, [latexCompletions], "latex")).toBe(ghost);
  });

  it("completes a Typst reference with an accented key", async () => {
    const source = keySource(/@[\p{L}\p{M}\p{N}_:.+/-]*$/u, ["obr:\u00FAvod", "vod"]);
    expect(await ghostFor("Viz @obr:\u00FAvo", [source], "typst")).toBe("d");
  });

  it("completes a Markdown anchor with an accented id", async () => {
    const source = keySource(/\]\(#[\p{L}\p{M}\p{N}_:.+/-]*$/u, ["\u00FAvod"]);
    expect(await ghostFor("Viz [x](#\u00FAvo", [source], "markdown")).toBe("d");
  });
});

describe("requested ghost completion", () => {
  type Call = {
    before: string;
    after: string;
    signal: AbortSignal;
    onText: (text: string) => void;
    resolve: () => void;
  };

  function requester() {
    const calls: Call[] = [];
    const request = (input: Omit<Call, "resolve">) =>
      new Promise<void>((resolve) => calls.push({ ...input, resolve }));
    return { calls, request };
  }

  function mountRequested(
    doc: string,
    request: ReturnType<typeof requester>["request"],
    options: { enabled?: () => boolean; warm?: () => void; extensions?: Extension[] } = {},
  ): EditorView {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          ...(options.extensions ?? []),
          requestedGhostCompletion(request, { delayMs: 50, enabled: options.enabled, warm: options.warm }),
        ],
      }),
      parent: document.body,
    });
    view.focus();
    return view;
  }

  function type(view: EditorView, text: string) {
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: "input.type",
    });
  }

  function backspace(view: EditorView) {
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at - 1, to: at },
      selection: { anchor: at - 1 },
      userEvent: "delete.backward",
    });
  }

  async function flush() {
    for (let round = 0; round < 5; round++) await Promise.resolve();
  }

  async function answer(call: Call | undefined, text: string) {
    call?.onText(text);
    call?.resolve();
    await flush();
  }

  async function shown(view: EditorView, request: ReturnType<typeof requester>, text: string) {
    vi.advanceTimersByTime(50);
    await answer(request.calls.at(-1), text);
    expect(pendingGhostCompletion(view)).not.toBeNull();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks after the pause and Tab inserts the answer", async () => {
    const requests = requester();
    const view = mountRequested("The results", requests.request);
    type(view, " sh");
    vi.advanceTimersByTime(49);
    expect(requests.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(requests.calls).toHaveLength(1);
    expect(requests.calls[0].before).toBe("The results sh");
    expect(requests.calls[0].after).toBe("");

    await answer(requests.calls[0], "ow a clear trend.");
    expect(pendingGhostCompletion(view)).toBe("ow a clear trend.");
    expect(view.dom.querySelector(".cm-ghostCompletion")?.textContent).toBe("ow a clear trend.");

    expect(acceptGhostCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("The results show a clear trend.");
    view.destroy();
  });

  it("shows whole words as they stream and stops at the first line break", async () => {
    const requests = requester();
    const view = mountRequested("The results", requests.request);
    type(view, "!");
    backspace(view);
    vi.advanceTimersByTime(50);
    const call = requests.calls[0];
    call.onText(" show a");
    expect(pendingGhostCompletion(view)).toBe(" show");
    call.onText(" show a clear");
    expect(pendingGhostCompletion(view)).toBe(" show a");
    call.onText(" show a clear trend.\nNext line");
    expect(pendingGhostCompletion(view)).toBe(" show a clear trend.");
    expect(call.signal.aborted).toBe(true);
    view.destroy();
  });

  it("keeps the rest of the suggestion while typing matches it, without asking again", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    await shown(view, requests, "orld peace");
    const asked = requests.calls.length;

    type(view, "o");
    expect(pendingGhostCompletion(view)).toBe("rld peace");
    vi.advanceTimersByTime(1_000);
    expect(requests.calls).toHaveLength(asked);

    type(view, "x");
    expect(pendingGhostCompletion(view)).toBeNull();
    vi.advanceTimersByTime(50);
    expect(requests.calls).toHaveLength(asked + 1);
    view.destroy();
  });

  it("keeps a stream going while typing matches it and drops it once typing leaves it", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    vi.advanceTimersByTime(50);
    const first = requests.calls[0];
    type(view, "o");
    expect(first.signal.aborted).toBe(false);
    await answer(first, "orld peace");
    expect(pendingGhostCompletion(view)).toBe("rld peace");
    expect(requests.calls.filter((call) => call.before.endsWith("Hello w"))).toHaveLength(1);

    type(view, " ");
    vi.advanceTimersByTime(50);
    const second = requests.calls.at(-1) as Call;
    second.onText("and calm now");
    type(view, "x");
    expect(second.signal.aborted).toBe(true);
    view.destroy();
  });

  it("shows an earlier answer again at once after a backspace", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    await shown(view, requests, "orld");
    type(view, "q");
    expect(pendingGhostCompletion(view)).toBeNull();
    const asked = requests.calls.length;

    backspace(view);
    await flush();
    expect(pendingGhostCompletion(view)).toBe("orld");
    expect(requests.calls).toHaveLength(asked);
    view.destroy();
  });

  it("fetches the next suggestion ahead so Tab shows it at once", async () => {
    const requests = requester();
    const view = mountRequested("The results", requests.request);
    type(view, " sh");
    await shown(view, requests, "ow a clear trend.");
    expect(requests.calls).toHaveLength(2);
    expect(requests.calls[1].before).toBe("The results show a clear trend.");
    await answer(requests.calls[1], " It holds for every model.");

    acceptGhostCompletion(view);
    await flush();
    expect(pendingGhostCompletion(view)).toBe(" It holds for every model.");
    expect(requests.calls).toHaveLength(2);
    view.destroy();
  });

  it("picks up the look-ahead request still in flight after Tab", async () => {
    const requests = requester();
    const view = mountRequested("The results", requests.request);
    type(view, " sh");
    await shown(view, requests, "ow a clear trend.");
    acceptGhostCompletion(view);
    await flush();
    expect(requests.calls).toHaveLength(2);
    await answer(requests.calls[1], " It holds.");
    expect(pendingGhostCompletion(view)).toBe(" It holds.");
    view.destroy();
  });

  it("drops the look-ahead request when the suggestion is abandoned", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    await shown(view, requests, "orld");
    const ahead = requests.calls[1];
    view.dispatch({ selection: { anchor: 0 } });
    expect(ahead.signal.aborted).toBe(true);
    view.destroy();
  });

  it("warms the connection when typing starts after a quiet spell", async () => {
    const requests = requester();
    const warm = vi.fn();
    const view = mountRequested("Hello", requests.request, { warm });
    type(view, " w");
    type(view, "o");
    expect(warm).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    await answer(requests.calls[0], "");
    vi.advanceTimersByTime(29_000);
    type(view, "r");
    expect(warm).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    await answer(requests.calls[1], "");
    vi.advanceTimersByTime(31_000);
    type(view, "l");
    expect(warm).toHaveBeenCalledTimes(2);
    view.destroy();
  });

  it("drops an answer once the cursor has moved", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    vi.advanceTimersByTime(50);
    view.dispatch({ selection: { anchor: 0 } });
    await answer(requests.calls[0], "orld");
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("keeps the answer to one line and drops what the model echoed", async () => {
    const requests = requester();
    const view = mountRequested("Intro\n\\section{Res", requests.request);
    type(view, "u");
    vi.advanceTimersByTime(50);
    await answer(requests.calls[0], "\\section{Resu" + "lts}\nMore text");
    expect(pendingGhostCompletion(view)).toBe("lts}");
    view.destroy();
  });

  it("drops a leading space after a space and a closing brace the line already has", async () => {
    const requests = requester();
    const view = mountRequested("\\textbf{bold}", requests.request);
    view.dispatch({ selection: { anchor: "\\textbf{bold".length } });
    type(view, " ");
    vi.advanceTimersByTime(50);
    expect(requests.calls[0].after).toBe("}");
    await answer(requests.calls[0], "  claim}  ");
    expect(pendingGhostCompletion(view)).toBe("claim");
    view.destroy();
  });

  it("sends a window that starts on a block boundary, so the prompt prefix stays the same while typing", async () => {
    const requests = requester();
    const text = `${"word ".repeat(1200)}end`;
    const view = mountRequested(text, requests.request);
    type(view, "s");
    vi.advanceTimersByTime(50);
    await answer(requests.calls[0], "");
    type(view, " a");
    vi.advanceTimersByTime(50);
    const [first, second] = requests.calls;
    expect(second.before.startsWith(first.before)).toBe(true);
    expect((view.state.doc.length - second.before.length) % 1024).toBe(0);
    view.destroy();
  });

  it.each([
    ["with text after the cursor", (view: EditorView) => view.dispatch({ selection: { anchor: 3 } })],
    ["with a selection", (view: EditorView) => view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })],
  ])("does not ask %s", (_name, move) => {
    const requests = requester();
    const view = mountRequested("Hello there", requests.request);
    type(view, "!");
    move(view);
    vi.advanceTimersByTime(50);
    expect(requests.calls).toHaveLength(0);
    view.destroy();
  });

  it("does not ask on a blank line, for edits that were not typed, or while switched off", () => {
    const requests = requester();
    let enabled = false;
    const view = mountRequested("Hello\n", requests.request, { enabled: () => enabled });
    type(view, "x");
    vi.advanceTimersByTime(50);
    enabled = true;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "y" } });
    vi.advanceTimersByTime(50);
    type(view, "\n ");
    vi.advanceTimersByTime(50);
    expect(requests.calls).toHaveLength(0);
    view.destroy();
  });

  it("asks once the completion popup's own lookup has settled", async () => {
    const requests = requester();
    let settleLookup: (result: null) => void = () => {};
    const slowSource: CompletionSource = () =>
      new Promise((resolve) => {
        settleLookup = resolve;
      });
    const view = mountRequested("Hello", requests.request, {
      extensions: [autocompletion({ override: [slowSource], activateOnTyping: true })],
    });
    type(view, " w");
    vi.advanceTimersByTime(100);
    expect(completionStatus(view.state)).toBe("pending");
    expect(requests.calls).toHaveLength(0);

    settleLookup(null);
    await flush();
    vi.advanceTimersByTime(100);
    expect(requests.calls).toHaveLength(1);
    view.destroy();
  });

  it("leaves the word suggestion in place when one is showing", async () => {
    const requests = requester();
    const view = mountRequested("\\al", requests.request, { extensions: [ghostCompletion([sourceOf(["\\alpha"])])] });
    type(view, "p");
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    vi.advanceTimersByTime(50);
    expect(requests.calls).toHaveLength(0);
    view.destroy();
  });

  it("Escape hides the answer and nothing is asked until the next keystroke", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    await shown(view, requests, "orld");
    const asked = requests.calls.length;
    expect(clearGhostCompletion(view)).toBe(true);
    expect(pendingGhostCompletion(view)).toBeNull();
    vi.advanceTimersByTime(500);
    expect(requests.calls).toHaveLength(asked);
    view.destroy();
  });

  it("aborts open requests when the editor closes", async () => {
    const requests = requester();
    const view = mountRequested("Hello", requests.request);
    type(view, " w");
    await shown(view, requests, "orld");
    type(view, "o");
    view.destroy();
    expect(requests.calls.every((call) => call.signal.aborted)).toBe(true);
  });
});
