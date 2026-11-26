// @vitest-environment jsdom
import { parseSnippetFile, type SnippetRecord } from "@oleafly/snippets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  store: {
    load: vi.fn(async () => undefined),
    recordUse: vi.fn(),
    disableRegex: vi.fn(async (_id: string) => undefined),
    useCounts: { "user.fig": 3 } as Record<string, number>,
    library: { records: [] },
    files: [] as unknown[],
  },
  files: { projectName: "", engine: { typst_resolved: null as null | { version: string } } },
  watch: vi.fn(() => () => undefined),
  toast: { info: vi.fn() },
  notifyError: vi.fn(),
  logError: vi.fn(async () => undefined),
  readClipboardText: vi.fn(async () => "copied"),
  renderSnippetMath: vi.fn(() => null),
  openSnippetSettings: vi.fn(),
  projectItems: vi.fn(() => [{ label: "fig:map" }]),
  fastMathEnabled: vi.fn(() => false),
  setFastMath: vi.fn(async () => undefined),
}));

vi.mock("./store", () => ({ useSnippetStore: { getState: () => mocks.store }, watchSnippetFiles: mocks.watch }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/clipboard", () => ({ readClipboardText: mocks.readClipboardText }));
vi.mock("./math-preview", () => ({ renderSnippetMath: mocks.renderSnippetMath }));
vi.mock("./open-settings", () => ({ openSnippetSettings: mocks.openSnippetSettings }));
vi.mock("./project-items", () => ({ projectItems: mocks.projectItems }));
vi.mock("./fast-math", () => ({ fastMathEnabled: mocks.fastMathEnabled, setFastMath: mocks.setFastMath }));

import { createSnippetPort } from "./port";

function record(id: string, entry: Record<string, unknown>): SnippetRecord {
  return parseSnippetFile(JSON.stringify({ [id]: entry }), "mine", "user").records[0];
}

const FRACTION = record("fm.frac", { name: "Fraction", prefix: "//", body: "\\frac{$1}{$2}$0", expand: "auto" });
const SUBSCRIPT = record("fm.sub", { name: "Auto subscript", prefix: "re:([A-Za-z])(\\d)", body: "[[0]]_[[1]]", expand: "auto" });

let path: string | null = "paper/main.tex";

async function port() {
  const created = createSnippetPort(() => path);
  await vi.dynamicImportSettled();
  return created;
}

function lastToast() {
  return mocks.toast.info.mock.calls.at(-1) as unknown as [string, { label: string; onClick: () => void } | undefined];
}

beforeEach(() => {
  vi.clearAllMocks();
  path = "paper/main.tex";
  mocks.files.projectName = "";
  mocks.files.engine.typst_resolved = null;
  mocks.fastMathEnabled.mockReturnValue(false);
  useSettingsStore.setState({
    snippetsInList: true,
    snippetsTab: true,
    snippetsAuto: true,
    snippetsHint: true,
    snippetAutoNoteShown: false,
    snippetFastMathTipShown: false,
  });
});

describe("createSnippetPort", () => {
  it("loads the snippet files and watches them once, however many editors ask, and logs a failed load", async () => {
    const failure = new Error("disk gone");
    mocks.store.load.mockRejectedValueOnce(failure);
    createSnippetPort(() => path);
    createSnippetPort(() => "other.typ");
    expect(mocks.store.load).toHaveBeenCalledOnce();
    expect(mocks.watch).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("load snippets", failure));
  });

  it("maps the file's extension to a snippet language and reports the path it was given", async () => {
    const snippets = await port();
    const cases: [string | null, string | null][] = [
      ["paper/main.tex", "latex"],
      ["styles/paper.STY", "latex"],
      ["class.cls", "latex"],
      ["old.ltx", "latex"],
      ["main.typ", "typst"],
      ["README.md", "markdown"],
      ["report.qmd", "markdown"],
      ["analysis.Rmd", "markdown"],
      ["refs.bib", "bibtex"],
      ["notes.txt", null],
      [null, null],
    ];
    for (const [file, language] of cases) {
      path = file;
      expect(snippets.language()).toBe(language);
      expect(snippets.filePath()).toBe(file);
    }
  });

  it("reads the library, use counts and project details from the stores at call time", async () => {
    const snippets = await port();
    expect(snippets.library()).toBe(mocks.store.library);
    expect(snippets.useCount("user.fig")).toBe(3);
    expect(snippets.useCount("user.other")).toBe(0);
    snippets.recordUse("user.fig");
    expect(mocks.store.recordUse).toHaveBeenCalledWith("user.fig");
    expect(snippets.projectName()).toBeNull();
    mocks.files.projectName = "Thesis";
    expect(snippets.projectName()).toBe("Thesis");
    expect(snippets.projectItems("label")).toEqual([{ label: "fig:map" }]);
    expect(mocks.projectItems).toHaveBeenCalledWith("label");
    await expect(snippets.readClipboard()).resolves.toBe("copied");
    expect(snippets.renderMathPreview?.("x", "latex")).toBeNull();
    expect(mocks.renderSnippetMath).toHaveBeenCalledWith("x", "latex");
    expect(snippets.collectionName?.("my-snippets")).toBe(enShell.snippets.mySnippets);
    expect(snippets.collectionName?.("someone-else")).toBe("someone-else");
  });

  it("reads the Typst version as major and minor", async () => {
    const snippets = await port();
    expect(snippets.typstVersion()).toBeUndefined();
    mocks.files.engine.typst_resolved = { version: " 0.13.1 " };
    expect(snippets.typstVersion()).toEqual([0, 13]);
    mocks.files.engine.typst_resolved = { version: "nightly" };
    expect(snippets.typstVersion()).toBeUndefined();
  });

  it("reads the four switches on every call", async () => {
    const snippets = await port();
    expect(snippets.enabled()).toEqual({ list: true, tab: true, auto: true, hint: true });
    useSettingsStore.getState().setSnippetsAuto(false);
    useSettingsStore.getState().setSnippetsHint(false);
    expect(snippets.enabled()).toEqual({ list: true, tab: true, auto: false, hint: false });
  });

  it("opens Settings at a snippet", async () => {
    const snippets = await port();
    snippets.editSnippet?.("user.fig");
    expect(mocks.openSnippetSettings).toHaveBeenCalledWith("user.fig");
  });

  it("says once how to take back an expansion as you type", async () => {
    const snippets = await port();
    snippets.onAutoExpanded(FRACTION);
    expect(lastToast()[0]).toBe("Expanded //. Undo or Backspace gives it back.");
    expect(useSettingsStore.getState().snippetAutoNoteShown).toBe(true);
    snippets.onAutoExpanded(FRACTION);
    expect(mocks.toast.info).toHaveBeenCalledOnce();
  });

  it("names a regular expression trigger by the snippet's name", async () => {
    const snippets = await port();
    snippets.onAutoExpanded(SUBSCRIPT);
    expect(lastToast()[0]).toBe("Expanded Auto subscript. Undo or Backspace gives it back.");
  });

  it("offers Fast math after the third fraction typed by hand, and only once", async () => {
    const snippets = await port();
    snippets.onHandTypedFraction();
    snippets.onHandTypedFraction();
    expect(mocks.toast.info).not.toHaveBeenCalled();
    snippets.onHandTypedFraction();
    const [message, action] = lastToast();
    expect(message).toBe(enShell.snippets.fastMathTip);
    expect(action?.label).toBe(enShell.snippets.turnOnFastMath);
    action?.onClick();
    expect(mocks.setFastMath).toHaveBeenCalledWith("latex", true);
    expect(useSettingsStore.getState().snippetFastMathTipShown).toBe(true);
    snippets.onHandTypedFraction();
    expect(mocks.toast.info).toHaveBeenCalledOnce();
  });

  it("tells the user when Fast math could not be turned on from the tip", async () => {
    const failure = new Error("read-only");
    mocks.setFastMath.mockRejectedValueOnce(failure);
    const snippets = await port();
    for (let typed = 0; typed < 3; typed += 1) snippets.onHandTypedFraction();
    lastToast()[1]?.onClick();
    await vi.waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith("turn on Fast math", failure));
  });

  it("does not offer Fast math when it is on already or outside LaTeX", async () => {
    mocks.fastMathEnabled.mockReturnValue(true);
    const snippets = await port();
    for (let typed = 0; typed < 4; typed += 1) snippets.onHandTypedFraction();
    expect(mocks.toast.info).not.toHaveBeenCalled();
    mocks.fastMathEnabled.mockReturnValue(false);
    path = "main.typ";
    const typst = await port();
    for (let typed = 0; typed < 4; typed += 1) typst.onHandTypedFraction();
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("does not offer Fast math again after the tip was shown in an earlier session", async () => {
    useSettingsStore.getState().setSnippetFastMathTipShown(true);
    const snippets = await port();
    for (let typed = 0; typed < 3; typed += 1) snippets.onHandTypedFraction();
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("switches off a slow trigger and logs a failure to save that", async () => {
    const snippets = await port();
    snippets.reportSlowRegex(SUBSCRIPT);
    expect(mocks.store.disableRegex).toHaveBeenCalledWith("fm.sub");
    const failure = new Error("locked");
    mocks.store.disableRegex.mockRejectedValueOnce(failure);
    snippets.reportSlowRegex(SUBSCRIPT);
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("switch off a slow snippet trigger", failure));
  });
});
