// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  hoverUniverseLink,
  languageServiceCompletion,
  semanticClassName,
} from "./language-service";
import {
  colorDecorations,
  cssColorFromValue,
  documentLinksFromValue,
  inlayHintDecorations,
  signatureHelpFromValue,
} from "./language-service-assist";
import {
  formatActiveBeforeSave,
  formatsOnSave,
  formatWithLanguageService,
  saveTypstDocument,
} from "./language-service-format";
import { setEditorView } from "./controller";

const TYPST_MODIFIERS = ["strong", "emph", "math", "readonly", "static", "defaultLibrary"];

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

describe("Tinymist semantic tokens", () => {
  it("maps Typst markup tokens onto highlight classes", () => {
    expect(semanticClassName("heading", 0, TYPST_MODIFIERS)).toBe("cm-semantic-heading");
    expect(semanticClassName("raw", 0, TYPST_MODIFIERS)).toBe("cm-semantic-string");
    expect(semanticClassName("label", 0, TYPST_MODIFIERS)).toBe("cm-semantic-label");
    expect(semanticClassName("ref", 0, TYPST_MODIFIERS)).toBe("cm-semantic-label");
    expect(semanticClassName("marker", 0, TYPST_MODIFIERS)).toBe("cm-semantic-keyword");
    expect(semanticClassName("delim", 0, TYPST_MODIFIERS)).toBe("cm-semantic-bracket");
    expect(semanticClassName("pol", 0, TYPST_MODIFIERS)).toBe("cm-semantic-variable");
    expect(semanticClassName("error", 0, TYPST_MODIFIERS)).toBe("cm-semantic-error");
    expect(semanticClassName("link", 0, TYPST_MODIFIERS)).toBe("cm-semantic-link");
    expect(semanticClassName("escape", 0, TYPST_MODIFIERS)).toBe("cm-semantic-escape");
    expect(semanticClassName("function", 0, TYPST_MODIFIERS)).toBe("cm-semantic-function");
  });

  it("styles strong and emphasised text through modifiers", () => {
    expect(semanticClassName("text", 0b1, TYPST_MODIFIERS)).toBe("cm-semantic-strong");
    expect(semanticClassName("text", 0b10, TYPST_MODIFIERS)).toBe("cm-semantic-emph");
    expect(semanticClassName("heading", 0b11, TYPST_MODIFIERS)).toBe(
      "cm-semantic-heading cm-semantic-strong cm-semantic-emph",
    );
    expect(semanticClassName("text", 0, TYPST_MODIFIERS)).toBeNull();
  });
});

describe("Typst Universe hover link", () => {
  const text = "#import \"@preview/cetz:0.3.1\": canvas\n#import \"util.typ\"\n";

  it("links a preview package import to its Universe page", () => {
    expect(hoverUniverseLink(text, text.indexOf("cetz"))).toEqual({
      href: "https://typst.app/universe/package/cetz",
      label: "Open on Typst Universe",
    });
  });

  it("ignores local imports and text outside the import", () => {
    expect(hoverUniverseLink(text, text.indexOf("util"))).toBeNull();
    expect(hoverUniverseLink(text, text.indexOf("canvas") + 2)).toBeNull();
  });
});

describe("signature help", () => {
  it("highlights the active parameter", () => {
    const help = signatureHelpFromValue(
      {
        activeSignature: 0,
        signatures: [
          {
            activeParameter: 1,
            label: "f(alpha: int, beta: 1 | int) -> int",
            parameters: [{ label: "alpha:" }, { label: "beta:" }],
            documentation: { kind: "markdown", value: "Adds things." },
          },
        ],
      },
      12,
    );
    expect(help).toMatchObject({
      pos: 12,
      label: "f(alpha: int, beta: 1 | int) -> int",
      active: { from: 14, to: 19 },
      documentation: "Adds things.",
    });
  });

  it("accepts label offsets and rejects an empty answer", () => {
    expect(
      signatureHelpFromValue(
        { signatures: [{ label: "g(x)", parameters: [{ label: [2, 3] }] }], activeParameter: 0 },
        0,
      )?.active,
    ).toEqual({ from: 2, to: 3 });
    expect(signatureHelpFromValue(null, 0)).toBeNull();
    expect(signatureHelpFromValue({ signatures: [] }, 0)).toBeNull();
  });
});

describe("inlay hints, colours and links", () => {
  const text = "#g(1, 2)\n#let c = rgb(\"#ff0000\")\n#image(\"pic.png\")\n";

  it("places parameter hints before their arguments", () => {
    const hints = inlayHintDecorations(
      [
        { kind: 2, label: "first:", paddingRight: true, position: { line: 0, character: 3 } },
        { kind: 2, label: [{ value: "second:" }], position: { line: 0, character: 6 } },
        { label: "bad", position: { line: 99, character: 0 } },
      ],
      text,
      "utf-16",
    );
    expect(hints.map((hint) => hint.from)).toEqual([3, 6]);
  });

  it("converts LSP colours to CSS and anchors swatches at the colour", () => {
    expect(cssColorFromValue({ red: 1, green: 0, blue: 0, alpha: 1 })).toBe(
      "rgba(255, 0, 0, 1)",
    );
    expect(cssColorFromValue({ red: "1" })).toBeNull();
    const swatches = colorDecorations(
      [{ color: { red: 1, green: 0, blue: 0, alpha: 1 }, range: range(1, 9, 23) }],
      text,
      "utf-16",
    );
    expect(swatches.map((swatch) => swatch.from)).toEqual([text.indexOf("rgb")]);
  });

  it("reads document link targets", () => {
    expect(
      documentLinksFromValue(
        [{ range: range(2, 8, 15), target: "file:///project/pic.png" }],
        text,
        "utf-16",
      ),
    ).toEqual([
      {
        from: text.indexOf("pic.png"),
        to: text.indexOf("pic.png") + 7,
        target: "file:///project/pic.png",
      },
    ]);
  });
});

describe("Typst requests through the editor", () => {
  const requestCompletion = vi.fn();
  const requestFormatting = vi.fn();
  const requestRangeFormatting = vi.fn();
  let deactivate: (() => void) | null = null;
  let views: EditorView[] = [];

  function activate(text: string) {
    useFilesStore.setState({
      projectId: "project-typst",
      activePath: "main.typ",
      files: { "main.typ": { content: text, dirty: false } },
    });
    deactivate = activateInteractiveLanguageService({
      owner: {},
      projectId: "project-typst",
      projectRevision: 1,
      kind: "tinymist",
      positionEncoding: "utf-16",
      client: {
        generation: 1,
        workspaceRoot: "/project",
        supports: () => true,
        capabilities: {
          completionTriggerCharacters: ["#", "(", "<", ",", ".", ":", "/", "\"", "@"],
        },
        requestCompletion,
        requestFormatting,
        requestRangeFormatting,
      } as unknown as LanguageServiceClient,
      documentForPath: (path) =>
        path === "main.typ"
          ? { path, uri: "file:///project/main.typ", text, version: 1 }
          : null,
    });
  }

  function editor(text: string, anchor: number, head = anchor): EditorView {
    const view = new EditorView({
      state: EditorState.create({ doc: text, selection: { anchor, head } }),
      parent: document.body,
    });
    views.push(view);
    return view;
  }

  beforeEach(() => {
    requestCompletion.mockReset();
    requestFormatting.mockReset();
    requestRangeFormatting.mockReset();
  });

  afterEach(() => {
    deactivate?.();
    deactivate = null;
    for (const view of views) view.destroy();
    views = [];
  });

  it("sends the trigger character when # opens completion", async () => {
    const text = "Hello #";
    activate(text);
    requestCompletion.mockResolvedValue({
      items: [
        {
          label: "image",
          kind: 3,
          insertTextFormat: 2,
          textEdit: { newText: ["image(", "$", "{1:})"].join(""), range: range(0, 7, 7) },
        },
      ],
    });
    const state = EditorState.create({ doc: text });
    const result = await languageServiceCompletion(
      new CompletionContext(state, text.length, false),
    );
    expect(requestCompletion.mock.calls[0][0]).toMatchObject({
      position: { line: 0, character: 7 },
      context: { triggerKind: 2, triggerCharacter: "#" },
    });
    expect(result?.options.map((option) => option.label)).toEqual(["image"]);
  });

  it("does not ask for completion at the end of a sentence", async () => {
    const text = "The end.";
    activate(text);
    const state = EditorState.create({ doc: text });
    await expect(
      languageServiceCompletion(new CompletionContext(state, text.length, false)),
    ).resolves.toBeNull();
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("formats the document with the configured indent and keeps undo", async () => {
    const text = "#let f(a,b)=a\n";
    activate(text);
    useSettingsStore.getState().setTypstFormatterIndent(4);
    const view = editor(text, 0);
    requestFormatting.mockResolvedValue([
      { newText: "#let f(a, b) = a", range: range(0, 0, 13) },
    ]);
    await expect(formatWithLanguageService(view, "document")).resolves.toBe("formatted");
    expect(requestFormatting.mock.calls[0][0]).toEqual({
      textDocument: { uri: "file:///project/main.typ" },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(view.state.doc.toString()).toBe("#let f(a, b) = a\n");
    useSettingsStore.getState().setTypstFormatterIndent(2);
  });

  it("formats only the selection when one is active", async () => {
    const text = "#f(1,2)\n#g(3,4)\n";
    activate(text);
    requestRangeFormatting.mockResolvedValue([
      { newText: "#g(3, 4)", range: range(1, 0, 7) },
    ]);
    const view = editor(text, 8, 15);
    await expect(formatWithLanguageService(view, "selection")).resolves.toBe("formatted");
    expect(requestRangeFormatting.mock.calls[0][0].range).toEqual(range(1, 0, 7));
    expect(view.state.doc.toString()).toBe("#f(1,2)\n#g(3, 4)\n");
  });

  describe("format on save", () => {
    const originalSaveFile = useFilesStore.getState().saveFile;
    const saveFile = vi.fn(async (_path: string, _options?: { overwrite?: boolean }) => {});

    beforeEach(() => {
      saveFile.mockClear();
      useFilesStore.setState({ saveFile });
      useSettingsStore.getState().setTypstFormatOnSave(true);
    });

    afterEach(() => {
      useFilesStore.setState({ saveFile: originalSaveFile });
      useSettingsStore.getState().setTypstFormatOnSave(false);
      setEditorView(null);
    });

    it("formats the document and then saves it", async () => {
      const text = "#let f(a,b)=a\n";
      activate(text);
      const view = editor(text, 0);
      requestFormatting.mockResolvedValue([
        { newText: "#let f(a, b) = a", range: range(0, 0, 13) },
      ]);
      await saveTypstDocument(view);
      expect(view.state.doc.toString()).toBe("#let f(a, b) = a\n");
      expect(saveFile).toHaveBeenCalledWith("main.typ", { overwrite: true });
    });

    it("saves the file the save started on when the tab changes while formatting", async () => {
      const text = "#let f(a,b)=a\n";
      activate(text);
      requestFormatting.mockImplementation(async () => {
        useFilesStore.setState({ activePath: "other.typ" });
        return [{ newText: "#let f(a, b) = a", range: range(0, 0, 13) }];
      });
      await saveTypstDocument(editor(text, 0));
      expect(saveFile).toHaveBeenCalledOnce();
      expect(saveFile).toHaveBeenCalledWith("main.typ", { overwrite: true });
    });

    it("saves without formatting when the setting is off", async () => {
      const text = "#let f(a,b)=a\n";
      activate(text);
      useSettingsStore.getState().setTypstFormatOnSave(false);
      await saveTypstDocument(editor(text, 0));
      expect(requestFormatting).not.toHaveBeenCalled();
      expect(saveFile).toHaveBeenCalledWith("main.typ", { overwrite: true });
    });

    it("still saves when the formatter throws", async () => {
      const text = "#let f(a,b)=a\n";
      activate(text);
      const view = editor(text, 0);
      requestFormatting.mockResolvedValue([
        { newText: "#let f(a, b) = a", range: range(0, 0, 13) },
      ]);
      view.dispatch = () => {
        throw new Error("read-only editor");
      };
      await expect(saveTypstDocument(view)).resolves.toBeUndefined();
      expect(saveFile).toHaveBeenCalledWith("main.typ", { overwrite: true });
    });

    it("formats the shared editor view for saves that start outside the keymap", async () => {
      const text = "#let f(a,b)=a\n";
      activate(text);
      const view = editor(text, 0);
      setEditorView(view);
      requestFormatting.mockResolvedValue([
        { newText: "#let f(a, b) = a", range: range(0, 0, 13) },
      ]);
      expect(formatsOnSave("main.typ")).toBe(true);
      expect(formatsOnSave("main.tex")).toBe(false);
      await formatActiveBeforeSave();
      expect(view.state.doc.toString()).toBe("#let f(a, b) = a\n");
      expect(saveFile).not.toHaveBeenCalled();
    });
  });
});
