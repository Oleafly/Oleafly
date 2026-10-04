// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const shell = vi.hoisted(() => ({ open: vi.fn(async (_url: string) => {}) }));
const location = vi.hoisted(() => ({
  openProjectLocation: vi.fn(async (_target: { path: string }) => true),
}));
const log = vi.hoisted(() => ({ logError: vi.fn(async (_scope: string, _error: unknown) => {}) }));

vi.mock("@tauri-apps/plugin-shell", () => shell);
vi.mock("@/lib/open-location", () => location);
vi.mock("@/lib/log", () => log);

import {
  documentLinkAt,
  languageServiceAssistExtensions,
  openDocumentLinkTarget,
  signatureHelpFromValue,
} from "./language-service-assist";

const PROJECT = "project-assist";
const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

const client = {
  generation: 1,
  workspaceRoot: "/project",
  supports: vi.fn((_feature: string) => true),
  capabilities: { signatureHelp: { triggerCharacters: ["(", ","] } },
  requestSignatureHelp: vi.fn(),
  requestInlayHints: vi.fn(),
  requestDocumentColors: vi.fn(),
  requestDocumentLinks: vi.fn(),
};

let deactivate: (() => void) | null = null;
let views: EditorView[] = [];

function activate(text: string, active = "main.typ") {
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: active,
    files: { [active]: { content: text, dirty: false } },
  });
  deactivate?.();
  deactivate = activateInteractiveLanguageService({
    owner: {},
    projectId: PROJECT,
    projectRevision: 1,
    kind: "tinymist",
    positionEncoding: "utf-16",
    client: client as unknown as LanguageServiceClient,
    documentForPath: (path) => {
      const content = useFilesStore.getState().files[path]?.content;
      return content === undefined
        ? null
        : { path, uri: `file:///project/${path}`, text: content, version: 1 };
    },
  });
}

function syncStore(view: EditorView) {
  const path = useFilesStore.getState().activePath as string;
  useFilesStore.setState({
    files: { [path]: { content: view.state.doc.toString(), dirty: true } },
  });
}

function typeText(view: EditorView, insert: string) {
  const at = view.state.selection.main.head;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    userEvent: "input.type",
  });
  syncStore(view);
}

function editor(text: string, anchor = text.length): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor },
      extensions: languageServiceAssistExtensions(),
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function supportOnly(features: string[]) {
  client.supports.mockImplementation((feature: string) => features.includes(feature));
}

const HELP = {
  activeSignature: 0,
  signatures: [
    {
      label: "rect(width: auto, height: auto)",
      parameters: [{ label: "width:" }, { label: "height:" }],
      activeParameter: 1,
      documentation: "Draws a rectangle.",
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of [
    client.requestSignatureHelp,
    client.requestInlayHints,
    client.requestDocumentColors,
    client.requestDocumentLinks,
  ]) {
    mock.mockReset();
    mock.mockResolvedValue(null);
  }
  client.supports.mockReset();
  client.supports.mockReturnValue(true);
  shell.open.mockReset();
  shell.open.mockResolvedValue(undefined);
  location.openProjectLocation.mockReset();
  location.openProjectLocation.mockResolvedValue(true);
  log.logError.mockClear();
  useSettingsStore.setState({ typstInlayHints: false });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  deactivate?.();
  deactivate = null;
  vi.useRealTimers();
});

describe("signature help", () => {
  function tooltip(view: EditorView) {
    return view.dom.querySelector(".cm-signature-help");
  }

  it("opens after a trigger character with the active parameter highlighted", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    client.requestSignatureHelp.mockResolvedValue(HELP);
    const view = editor("#rect");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(59);
    expect(client.requestSignatureHelp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.requestSignatureHelp.mock.calls[0][0]).toEqual({
      textDocument: { uri: "file:///project/main.typ" },
      position: { line: 0, character: 6 },
      context: { triggerKind: 2, triggerCharacter: "(", isRetrigger: false },
    });
    expect(tooltip(view)?.querySelector(".cm-signature-help-active")?.textContent).toBe("height:");
    expect(tooltip(view)?.querySelector(".cm-signature-help-label")?.textContent).toBe(
      "rect(width: auto, height: auto)",
    );
    expect(tooltip(view)?.querySelector(".cm-signature-help-documentation")?.textContent).toBe(
      "Draws a rectangle.",
    );
  });

  it("re-triggers while open and closes when the answer is empty", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    client.requestSignatureHelp.mockResolvedValueOnce(HELP);
    const view = editor("#rect");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    expect(tooltip(view)).not.toBeNull();

    client.requestSignatureHelp.mockResolvedValueOnce(null);
    typeText(view, "1");
    await vi.advanceTimersByTimeAsync(60);
    expect(client.requestSignatureHelp.mock.calls[1][0].context).toEqual({
      triggerKind: 3,
      isRetrigger: true,
      activeSignatureHelp: HELP,
    });
    expect(tooltip(view)).toBeNull();
  });

  it("shows the bare label when no parameter is active", async () => {
    activate("#f");
    supportOnly(["signatureHelp"]);
    client.requestSignatureHelp.mockResolvedValue({ signatures: [{ label: "f()" }] });
    const view = editor("#f");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    expect(tooltip(view)?.textContent).toBe("f()");
    expect(tooltip(view)?.querySelector(".cm-signature-help-active")).toBeNull();
  });

  it("closes on Escape without consuming the key", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    client.requestSignatureHelp.mockResolvedValue(HELP);
    const view = editor("#rect");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    expect(tooltip(view)).not.toBeNull();
    const handled = runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Escape" }), "editor");
    expect(handled).toBe(false);
    expect(tooltip(view)).toBeNull();
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Escape" }), "editor")).toBe(false);
  });

  it("closes when the request fails", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    client.requestSignatureHelp.mockResolvedValueOnce(HELP);
    const view = editor("#rect");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    client.requestSignatureHelp.mockRejectedValueOnce(new Error("timeout"));
    typeText(view, ",");
    await vi.advanceTimersByTimeAsync(60);
    expect(client.requestSignatureHelp).toHaveBeenCalledTimes(2);
    expect(tooltip(view)).toBeNull();
  });

  it("ignores characters that are not triggers and services without support", async () => {
    activate("#rect");
    supportOnly([]);
    const view = editor("#rect");
    typeText(view, "(");
    typeText(view, "x");
    await vi.advanceTimersByTimeAsync(120);
    expect(client.requestSignatureHelp).not.toHaveBeenCalled();
  });

  it("asks nothing outside Typst files", async () => {
    activate("\\frac", "main.tex");
    supportOnly(["signatureHelp"]);
    const view = editor("\\frac");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    expect(client.requestSignatureHelp).not.toHaveBeenCalled();
    expect(tooltip(view)).toBeNull();
  });

  it("drops an answer for text that changed in the meantime", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    let resolve: (value: unknown) => void = () => {};
    client.requestSignatureHelp.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = editor("#rect");
    typeText(view, "(");
    await vi.advanceTimersByTimeAsync(60);
    view.dispatch({ changes: { from: 0, insert: " " } });
    resolve(HELP);
    await vi.advanceTimersByTimeAsync(0);
    expect(tooltip(view)).toBeNull();
  });

  it("stops a pending request when the editor closes", async () => {
    activate("#rect");
    supportOnly(["signatureHelp"]);
    const view = editor("#rect");
    typeText(view, "(");
    view.destroy();
    await vi.advanceTimersByTimeAsync(60);
    expect(client.requestSignatureHelp).not.toHaveBeenCalled();
  });
});

describe("signatureHelpFromValue", () => {
  it("falls back to the first signature and the outer active parameter", () => {
    expect(
      signatureHelpFromValue(
        {
          activeSignature: 7,
          activeParameter: 0,
          signatures: [{ label: "g(a, b)", parameters: [{ label: "a" }, "junk", { label: [9, 1] }] }],
        },
        3,
      ),
    ).toMatchObject({ label: "g(a, b)", active: { from: 2, to: 3 }, documentation: null });
  });

  it("rejects signatures without a label and keeps unmatched parameters inactive", () => {
    expect(signatureHelpFromValue({ signatures: [{ parameters: [] }] }, 0)).toBeNull();
    expect(signatureHelpFromValue({ signatures: [7] }, 0)).toBeNull();
    expect(
      signatureHelpFromValue(
        {
          signatures: [
            {
              label: "h(x)",
              parameters: [{ label: "missing" }],
              activeParameter: 0,
              documentation: { kind: "markdown", value: "  Docs\0  " },
            },
          ],
        },
        0,
      ),
    ).toMatchObject({ active: null, documentation: "Docs" });
    expect(
      signatureHelpFromValue(
        { signatures: [{ label: "k()", documentation: { value: 3 } }], activeParameter: 0 },
        0,
      ),
    ).toMatchObject({ active: null, documentation: null });
  });
});

describe("inlay hints, colour swatches and links", () => {
  const TEXT = "#rect(1, 2)\n#let c = rgb(\"#ff0000\")\n#image(\"pic.png\")\n";

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("decorates hints and colours and records document links", async () => {
    useSettingsStore.setState({ typstInlayHints: true });
    activate(TEXT);
    client.requestInlayHints.mockResolvedValue([
      { label: "width:", paddingRight: true, position: { line: 0, character: 6 } },
      { label: [{ value: "height:" }, { nope: 1 }], paddingLeft: true, position: { line: 0, character: 9 } },
      { label: "", position: { line: 0, character: 1 } },
      { label: [], position: { line: 0, character: 1 } },
      { label: "far", position: { line: 40, character: 0 } },
      { label: "bad", position: { line: "0", character: 0 } },
      { label: "none" },
      7,
    ]);
    client.requestDocumentColors.mockResolvedValue([
      { color: { red: 1, green: 0, blue: 0, alpha: 0.5 }, range: range(1, 9, 23) },
      { color: { red: 2, green: -1, blue: 0, alpha: 1 }, range: range(2, 0, 6) },
      { color: { red: 1 }, range: range(1, 9, 12) },
      { color: { red: 1, green: 0, blue: 0, alpha: 1 }, range: "bad" },
      "junk",
    ]);
    client.requestDocumentLinks.mockResolvedValue([
      { range: range(2, 8, 15), target: "file:///project/pic.png" },
      { range: range(2, 0, 1) },
      "junk",
    ]);
    const view = editor(TEXT, 0);
    await settle();
    expect(
      [...view.contentDOM.querySelectorAll(".cm-inlay-hint")].map((node) => node.textContent),
    ).toEqual(["width: ", " height:"]);
    const swatches = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-color-swatch")];
    expect(swatches.map((node) => node.style.backgroundColor)).toEqual([
      "rgba(255, 0, 0, 0.5)",
      "rgb(255, 0, 0)",
    ]);
    const at = TEXT.indexOf("pic.png");
    expect(documentLinkAt(view.state, at + 2)).toEqual({
      from: at,
      to: at + 7,
      target: "file:///project/pic.png",
    });
    expect(documentLinkAt(view.state, 0)).toBeNull();
    expect(client.requestInlayHints.mock.calls[0][0]).toMatchObject({
      textDocument: { uri: "file:///project/main.typ" },
      range: { start: { line: 0, character: 0 } },
    });
  });

  it("removes inlay hints when the setting is turned off", async () => {
    useSettingsStore.setState({ typstInlayHints: true });
    activate(TEXT);
    client.requestInlayHints.mockResolvedValue([
      { label: "width:", position: { line: 0, character: 6 } },
    ]);
    const view = editor(TEXT, 0);
    await settle();
    expect(view.contentDOM.querySelectorAll(".cm-inlay-hint")).toHaveLength(1);
    useSettingsStore.setState({ typstInlayHints: false });
    await settle();
    expect(view.contentDOM.querySelectorAll(".cm-inlay-hint")).toHaveLength(0);
    expect(client.requestInlayHints).toHaveBeenCalledTimes(1);
  });

  it("clears colour swatches when the file is no longer Typst", async () => {
    activate(TEXT);
    client.requestDocumentColors.mockResolvedValue([
      { color: { red: 0, green: 0, blue: 1, alpha: 1 }, range: range(1, 9, 23) },
    ]);
    const view = editor(TEXT, 0);
    await settle();
    expect(view.contentDOM.querySelectorAll(".cm-color-swatch")).toHaveLength(1);
    activate(TEXT, "main.tex");
    await settle();
    expect(view.contentDOM.querySelectorAll(".cm-color-swatch")).toHaveLength(0);
  });

  it("refreshes after an edit settles and ignores answers for stale text", async () => {
    activate(TEXT);
    let resolve: (value: unknown) => void = () => {};
    client.requestDocumentColors.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = editor(TEXT, 0);
    await settle();
    expect(client.requestDocumentColors).toHaveBeenCalledTimes(1);
    view.dispatch({ changes: { from: TEXT.length, insert: "x" } });
    syncStore(view);
    resolve([{ color: { red: 0, green: 0, blue: 1, alpha: 1 }, range: range(1, 9, 23) }]);
    await vi.advanceTimersByTimeAsync(399);
    expect(view.contentDOM.querySelectorAll(".cm-color-swatch")).toHaveLength(0);
    expect(client.requestDocumentColors).toHaveBeenCalledTimes(1);
    client.requestDocumentColors.mockResolvedValueOnce([
      { color: { red: 0, green: 0, blue: 1, alpha: 1 }, range: range(1, 9, 23) },
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.requestDocumentColors).toHaveBeenCalledTimes(2);
    expect(view.contentDOM.querySelectorAll(".cm-color-swatch")).toHaveLength(1);
  });

  it("survives failed decoration requests", async () => {
    useSettingsStore.setState({ typstInlayHints: true });
    activate(TEXT);
    client.requestInlayHints.mockRejectedValue(new Error("a"));
    client.requestDocumentColors.mockRejectedValue(new Error("b"));
    client.requestDocumentLinks.mockRejectedValue(new Error("c"));
    const view = editor(TEXT, 0);
    await settle();
    expect(view.contentDOM.querySelector(".cm-inlay-hint, .cm-color-swatch")).toBeNull();
    expect(documentLinkAt(view.state, TEXT.indexOf("pic"))).toBeNull();
  });

  it("does not ask once the editor is gone", async () => {
    activate(TEXT);
    const view = editor(TEXT, 0);
    view.destroy();
    await settle();
    activate(TEXT);
    useSettingsStore.setState({ typstInlayHints: true });
    await settle();
    expect(client.requestDocumentColors).not.toHaveBeenCalled();
  });
});

describe("opening document links", () => {
  const TEXT = "#image(\"pic.png\")\n#link(\"https://typst.app\")\n";

  async function viewWithLinks() {
    activate(TEXT);
    client.requestDocumentLinks.mockResolvedValue([
      { range: range(0, 8, 15), target: "file:///project/pic.png" },
      { range: range(1, 7, 24), target: "https://typst.app" },
    ]);
    const view = editor(TEXT, 0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    return view;
  }

  function click(view: EditorView, pos: number | null, init: MouseEventInit) {
    vi.spyOn(view, "posAtCoords").mockReturnValue(pos as number);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1, ...init });
    view.contentDOM.dispatchEvent(event);
    return event;
  }

  it("opens a project file link on Ctrl-click", async () => {
    const view = await viewWithLinks();
    const event = click(view, TEXT.indexOf("pic"), { ctrlKey: true, button: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(location.openProjectLocation).toHaveBeenCalledWith({ path: "pic.png" });
  });

  it("opens a web link with the system browser on Cmd-click", async () => {
    const view = await viewWithLinks();
    click(view, TEXT.indexOf("typst.app"), { metaKey: true, button: 0 });
    expect(shell.open).toHaveBeenCalledWith("https://typst.app");
  });

  it("ignores plain clicks, other buttons, missing positions and empty spots", async () => {
    const view = await viewWithLinks();
    click(view, TEXT.indexOf("pic"), { button: 0 });
    click(view, TEXT.indexOf("pic"), { ctrlKey: true, button: 1 });
    click(view, null, { ctrlKey: true, button: 0 });
    click(view, 1, { ctrlKey: true, button: 0 });
    useFilesStore.setState({ activePath: "main.tex" });
    click(view, TEXT.indexOf("pic"), { ctrlKey: true, button: 0 });
    expect(location.openProjectLocation).not.toHaveBeenCalled();
    expect(shell.open).not.toHaveBeenCalled();
  });

  it("refuses targets outside the project and logs failures to open", async () => {
    activate("x");
    expect(openDocumentLinkTarget("file:///elsewhere/a.typ")).toBe(false);
    deactivate?.();
    deactivate = null;
    expect(openDocumentLinkTarget("file:///project/a.typ")).toBe(false);

    shell.open.mockRejectedValueOnce(new Error("no browser"));
    expect(openDocumentLinkTarget("HTTP://example.com")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.logError).toHaveBeenCalledWith("open document link", expect.any(Error));

    activate("x");
    location.openProjectLocation.mockRejectedValueOnce(new Error("gone"));
    expect(openDocumentLinkTarget("file:///project/a.typ")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.logError).toHaveBeenCalledTimes(2);
  });
});
