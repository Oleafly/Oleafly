// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { saveFailureToastKey, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";

const log = vi.hoisted(() => ({ logError: vi.fn(async (_scope: string, _error: unknown) => {}) }));
vi.mock("@/lib/log", () => log);

import { setEditorView } from "./controller";
import {
  formatActiveBeforeSave,
  formatWithLanguageService,
  LANGUAGE_SERVICE_FORMAT_TOAST_KEY,
  languageServiceFormattingAvailable,
  languageServiceFormattingKeymap,
  saveTypstDocument,
} from "./language-service-format";

const PROJECT = "project-format";
const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

const client = {
  generation: 1,
  workspaceRoot: "/project",
  supports: vi.fn((_feature: string) => true),
  capabilities: {},
  requestFormatting: vi.fn(),
  requestRangeFormatting: vi.fn(),
};

const saveFile = vi.fn(async (_path: string, _options?: { overwrite?: boolean }) => {});
const originalSaveFile = useFilesStore.getState().saveFile;
let deactivate: (() => void) | null = null;
let views: EditorView[] = [];

function activate(text: string, active = "main.typ", hasDocument = true) {
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: active,
    files: { [active]: { content: text, dirty: false } },
    saveFile,
  });
  deactivate?.();
  deactivate = activateInteractiveLanguageService({
    owner: {},
    projectId: PROJECT,
    projectRevision: 1,
    kind: "tinymist",
    positionEncoding: "utf-16",
    client: client as unknown as LanguageServiceClient,
    documentForPath: (path) =>
      hasDocument && path === active
        ? { path, uri: `file:///project/${active}`, text, version: 1 }
        : null,
  });
}

function editor(text: string, anchor = 0, head = anchor): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor, head },
      extensions: languageServiceFormattingKeymap(),
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function formatToast() {
  return useToastStore.getState().toasts.find((toast) => toast.key === LANGUAGE_SERVICE_FORMAT_TOAST_KEY);
}

beforeEach(() => {
  client.supports.mockReset();
  client.supports.mockReturnValue(true);
  client.requestFormatting.mockReset();
  client.requestRangeFormatting.mockReset();
  saveFile.mockReset();
  saveFile.mockResolvedValue(undefined);
  log.logError.mockClear();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  deactivate?.();
  deactivate = null;
  setEditorView(null);
  useFilesStore.setState({ saveFile: originalSaveFile });
  useSettingsStore.getState().setTypstFormatOnSave(false);
});

describe("formatWithLanguageService", () => {
  it("reports an unavailable formatter outside Typst files", async () => {
    activate("\\section{A}", "main.tex");
    await expect(formatWithLanguageService(editor("\\section{A}"))).resolves.toBe("unavailable");
    expect(formatToast()?.message).toBe(en.languageService.formatUnavailable);
    expect(client.requestFormatting).not.toHaveBeenCalled();
  });

  it("stays quiet when asked to", async () => {
    activate("#x", "main.typ", false);
    await expect(
      formatWithLanguageService(editor("#x"), "document", { quiet: true }),
    ).resolves.toBe("unavailable");
    expect(formatToast()).toBeUndefined();
  });

  it("needs range formatting support to format a selection", async () => {
    const text = "#f(1,2)\n";
    activate(text);
    client.supports.mockImplementation((feature: string) => feature === "formatting");
    await expect(formatWithLanguageService(editor(text, 0, 7), "selection")).resolves.toBe(
      "unavailable",
    );
    expect(client.requestRangeFormatting).not.toHaveBeenCalled();
  });

  it("formats the whole document for an empty selection", async () => {
    const text = "#f(1,2)\n";
    activate(text);
    client.requestFormatting.mockResolvedValue([{ newText: "#f(1, 2)", range: range(0, 0, 7) }]);
    await expect(formatWithLanguageService(editor(text, 3), "selection")).resolves.toBe("formatted");
    expect(client.requestFormatting).toHaveBeenCalledOnce();
  });

  it("reports and logs a failed request", async () => {
    const text = "#x\n";
    activate(text);
    const failure = new Error("formatter crashed");
    client.requestFormatting.mockRejectedValue(failure);
    await expect(formatWithLanguageService(editor(text))).resolves.toBe("failed");
    expect(log.logError).toHaveBeenCalledWith("language-service format", failure);
    expect(formatToast()?.message).toBe(en.languageService.formatFailed);
  });

  it("treats a failure after an edit as stale", async () => {
    const text = "#x\n";
    activate(text);
    const view = editor(text);
    client.requestFormatting.mockImplementation(async () => {
      view.dispatch({ changes: { from: 0, insert: " " } });
      throw new Error("cancelled");
    });
    await expect(formatWithLanguageService(view)).resolves.toBe("stale");
    expect(formatToast()).toBeUndefined();
  });

  it("drops edits for a document that changed or a session that moved on", async () => {
    const text = "#x\n";
    activate(text);
    const view = editor(text);
    client.requestFormatting.mockImplementationOnce(async () => {
      view.dispatch({ changes: { from: 0, insert: " " } });
      return [];
    });
    await expect(formatWithLanguageService(view)).resolves.toBe("stale");

    const fresh = editor(text);
    client.requestFormatting.mockImplementationOnce(async () => {
      useFilesStore.setState({ files: { "main.typ": { content: "#y\n", dirty: true } } });
      return [];
    });
    await expect(formatWithLanguageService(fresh)).resolves.toBe("stale");
    expect(fresh.state.doc.toString()).toBe(text);
  });

  it("fails on malformed edits and does nothing when the text is already formatted", async () => {
    const text = "#f(1, 2)\n";
    activate(text);
    client.requestFormatting.mockResolvedValueOnce({ edits: [] });
    await expect(formatWithLanguageService(editor(text))).resolves.toBe("failed");
    expect(formatToast()?.message).toBe(en.languageService.formatFailed);

    client.requestFormatting.mockResolvedValueOnce([{ newText: "#f(1, 2)", range: range(0, 0, 8) }]);
    await expect(formatWithLanguageService(editor(text))).resolves.toBe("unchanged");
    client.requestFormatting.mockResolvedValueOnce(null);
    await expect(formatWithLanguageService(editor(text))).resolves.toBe("unchanged");
  });

  it("applies several edits in document order", async () => {
    const text = "#a(1,2)\n#b(3,4)\n";
    activate(text);
    client.requestFormatting.mockResolvedValue([
      { newText: "#b(3, 4)", range: range(1, 0, 7) },
      { newText: "#a(1, 2)", range: range(0, 0, 7) },
    ]);
    const view = editor(text);
    await expect(formatWithLanguageService(view)).resolves.toBe("formatted");
    expect(view.state.doc.toString()).toBe("#a(1, 2)\n#b(3, 4)\n");
  });
});

describe("languageServiceFormattingAvailable", () => {
  it("needs a Typst file of the active project that the service tracks", () => {
    activate("#x");
    expect(languageServiceFormattingAvailable()).toBe(true);

    client.supports.mockReturnValue(false);
    expect(languageServiceFormattingAvailable()).toBe(false);
    client.supports.mockReturnValue(true);

    useFilesStore.setState({ projectId: "other" });
    expect(languageServiceFormattingAvailable()).toBe(false);

    activate("#x", "main.typ", false);
    expect(languageServiceFormattingAvailable()).toBe(false);

    activate("\\x", "main.tex");
    expect(languageServiceFormattingAvailable()).toBe(false);

    deactivate?.();
    deactivate = null;
    useFilesStore.setState({ activePath: "main.typ" });
    expect(languageServiceFormattingAvailable()).toBe(false);
  });
});

describe("saving Typst files", () => {
  it("does nothing before save without an editor", async () => {
    useSettingsStore.getState().setTypstFormatOnSave(true);
    activate("#x");
    setEditorView(null);
    await formatActiveBeforeSave();
    expect(client.requestFormatting).not.toHaveBeenCalled();
  });

  it("skips the save when the project changed while formatting", async () => {
    useSettingsStore.getState().setTypstFormatOnSave(true);
    const text = "#x\n";
    activate(text);
    client.requestFormatting.mockImplementation(async () => {
      useFilesStore.setState({ projectId: "another" });
      return [];
    });
    await saveTypstDocument(editor(text));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("reports a failed save for the file", async () => {
    activate("#x\n");
    saveFile.mockRejectedValue(new Error("disk full"));
    await saveTypstDocument(editor("#x\n"));
    expect(log.logError).toHaveBeenCalledWith("editor save", expect.any(Error));
    expect(
      useToastStore.getState().toasts.some((toast) => toast.key === saveFailureToastKey(PROJECT)),
    ).toBe(true);
  });

  it("logs a failed save that has no project to report against", async () => {
    activate("#x\n");
    useFilesStore.setState({ projectId: null, saveFile });
    await saveTypstDocument(editor("#x\n"));
    expect(saveFile).not.toHaveBeenCalled();

    const failing = vi.fn(async () => {
      throw new Error("no project");
    });
    useFilesStore.setState({ projectId: PROJECT, activePath: null, saveFile: failing });
    await saveTypstDocument(editor("#x\n"));
    expect(failing).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalledWith("editor save", expect.anything());
  });
});

describe("formatting keymap", () => {
  function press(view: EditorView, init: KeyboardEventInit) {
    return runScopeHandlers(view, new KeyboardEvent("keydown", init), "editor");
  }

  it("formats with Shift-Alt-F and saves with Mod-S in Typst files", async () => {
    const text = "#f(1,2)\n";
    activate(text);
    client.requestFormatting.mockResolvedValue([]);
    const view = editor(text);
    expect(press(view, { key: "F", keyCode: 70, shiftKey: true, altKey: true })).toBe(true);
    expect(client.requestFormatting).toHaveBeenCalledOnce();
    expect(press(view, { key: "s", keyCode: 83, ctrlKey: true })).toBe(true);
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledWith("main.typ", { overwrite: true }));
  });

  it("leaves the keys alone in other files", () => {
    activate("\\x", "main.tex");
    const view = editor("\\x");
    expect(press(view, { key: "F", keyCode: 70, shiftKey: true, altKey: true })).toBe(false);
    expect(press(view, { key: "s", keyCode: 83, ctrlKey: true })).toBe(false);
    expect(client.requestFormatting).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });
});
