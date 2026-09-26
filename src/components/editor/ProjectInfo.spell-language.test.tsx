// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { i18n } from "@/i18n";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
  setProjectDictionaryLocaleCmd: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listDictionaries: mocks.listDictionaries,
  setProjectDictionaryLocaleCmd: mocks.setProjectDictionaryLocaleCmd,
}));

const { ProjectInfoContent } = await import("./ProjectInfo");
const { refreshDictionaryCatalog } = await import(
  "@/lib/proofreading/dictionary-catalog"
);

const SNAPSHOT = {
  root: "/books/guide/main.tex",
  fileCount: 1,
  unreadable: [],
  stats: EMPTY_DOCUMENT_STATS,
  selectionWords: null,
};

const IDLE = {
  phase: "idle" as const,
  identity: null,
  message: null,
  diagnosticCount: 0,
  diagnostics: [],
  truncated: false,
  activeDictionaryLocale: null,
  retryable: true,
};

const IDENTITY = {
  projectId: "guide",
  path: "main.tex",
  revision: 1,
  requestGeneration: 1,
  surface: "source" as const,
};

function hunspellFinding(word: string) {
  return {
    from: 0,
    to: word.length,
    message: `Possible misspelling: “${word}”`,
    kind: "Spelling",
    source: "hunspell" as const,
    word,
    suggestions: [],
    rule: null,
  };
}

function statRow(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: "span" }).parentElement;
  if (!row) throw new Error(`missing row ${label}`);
  return row;
}

function entry(
  id: string,
  language: string,
  region: string | null,
  state: DictionaryInfo["state"],
): DictionaryInfo {
  return {
    id,
    language,
    region,
    license: { id: "MIT", url: "https://example.invalid/license" },
    bytes: 1_000,
    state,
  };
}

beforeAll(() => {
  for (const [name, value] of [
    ["hasPointerCapture", () => false],
    ["releasePointerCapture", () => {}],
    ["scrollIntoView", () => {}],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value,
    });
  }
});

beforeEach(async () => {
  mocks.listDictionaries.mockReset();
  mocks.listDictionaries.mockResolvedValue([
    entry("en_US", "English", "United States", "bundled"),
    entry("fr_FR", "French", "France", "bundled"),
    entry("es_ES", "Spanish", "Spain", "installed"),
    entry("it_IT", "Italian", "Italy", "available"),
  ]);
  mocks.setProjectDictionaryLocaleCmd.mockReset();
  mocks.setProjectDictionaryLocaleCmd.mockImplementation(
    async (_projectId: string, locale: string | null) => ({
      name: "Guide",
      main_doc: "main.tex",
      engine: "xetex",
      dictionary_locale: locale,
      allow_shell_escape: false,
      checkpoints: { mode: "engine_dependencies" },
    }),
  );
  useFilesStore.setState({
    projectId: "guide",
    activePath: "main.tex",
    projectDictionaryLocale: null,
  });
  useSettingsStore.setState({ spellcheck: true, harper: false });
  useProofreadingStore.setState({ source: IDLE });
  await refreshDictionaryCatalog();
});

describe("per-project spell-check language", () => {
  it("defaults to the app setting and offers only usable packs", async () => {
    const user = userEvent.setup();
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    const control = await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    });
    expect(control).toHaveTextContent(
      enEditor.projectInfo.spellLanguageAppSetting,
    );

    await user.click(control);
    expect(await screen.findByRole("option", { name: "French (France)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Spanish (Spain)" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Italian (Italy)" }),
    ).not.toBeInTheDocument();
  });

  it("stores the chosen language on the project and clears it again", async () => {
    const user = userEvent.setup();
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    const control = await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    });
    await user.click(control);
    await user.click(await screen.findByRole("option", { name: "French (France)" }));

    await waitFor(() =>
      expect(mocks.setProjectDictionaryLocaleCmd).toHaveBeenCalledWith(
        "guide",
        "fr_FR",
      ),
    );
    await waitFor(() =>
      expect(useFilesStore.getState().projectDictionaryLocale).toBe("fr_FR"),
    );

    await user.click(control);
    await user.click(
      await screen.findByRole("option", {
        name: enEditor.projectInfo.spellLanguageAppSetting,
      }),
    );

    await waitFor(() =>
      expect(mocks.setProjectDictionaryLocaleCmd).toHaveBeenLastCalledWith(
        "guide",
        null,
      ),
    );
    await waitFor(() =>
      expect(useFilesStore.getState().projectDictionaryLocale).toBeNull(),
    );
  });

  it("explains a rejected language change in plain words", async () => {
    const failure = "failed to set the spelling dictionary: unknown locale";
    mocks.setProjectDictionaryLocaleCmd.mockRejectedValue(failure);
    const user = userEvent.setup();
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    const control = await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    });
    await user.click(control);
    await user.click(await screen.findByRole("option", { name: "French (France)" }));

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledOnce());
    const message = i18n.t(($) => $.editor.projectInfo.spellLanguageFailed);
    expect(mocks.notifyError).toHaveBeenCalledWith("set the spelling language", failure, message);
    expect(message).not.toBe(failure);
    expect(useFilesStore.getState().projectDictionaryLocale).toBeNull();
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(control).toHaveTextContent(enEditor.projectInfo.spellLanguageAppSetting);
  });

  it("stays hidden when spell check is off", async () => {
    useSettingsStore.setState({ spellcheck: false });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    await waitFor(() => expect(mocks.listDictionaries).toHaveBeenCalled());
    expect(
      screen.queryByRole("combobox", {
        name: enEditor.projectInfo.spellLanguageAriaLabel,
      }),
    ).not.toBeInTheDocument();
  });

  it("ignores a dictionary response after switching projects", async () => {
    let finish!: (value: { dictionary_locale: string }) => void;
    mocks.setProjectDictionaryLocaleCmd.mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const user = userEvent.setup();
    const view = render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);
    await user.click(await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    }));
    await user.click(await screen.findByRole("option", { name: "French (France)" }));
    await waitFor(() => expect(mocks.setProjectDictionaryLocaleCmd).toHaveBeenCalledWith("guide", "fr_FR"));
    act(() => useFilesStore.setState({ projectId: "second-project", projectDictionaryLocale: "en_US" }));
    view.unmount();
    await act(async () => finish({ dictionary_locale: "fr_FR" }));
    expect(useFilesStore.getState().projectDictionaryLocale).toBe("en_US");
  });
});

describe("proofreading summary for the project language", () => {
  it("asks the open editors to re-proofread after the language changes", async () => {
    const events: string[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent<{ setting: string }>).detail.setting);
    window.addEventListener("oleafly:proofreading-settings-changed", listener);
    const user = userEvent.setup();
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);
    await user.click(await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    }));
    await user.click(await screen.findByRole("option", { name: "French (France)" }));
    await waitFor(() =>
      expect(useFilesStore.getState().projectDictionaryLocale).toBe("fr_FR"),
    );
    window.removeEventListener("oleafly:proofreading-settings-changed", listener);
    expect(events).toEqual(["projectDictionaryLocale"]);
  });

  it("stays quiet when the project picks the language the app already uses", () => {
    const events: string[] = [];
    const listener = () => events.push("changed");
    window.addEventListener("oleafly:proofreading-settings-changed", listener);
    useSettingsStore.setState({ dictionaryLocale: "fr_FR" });
    useFilesStore.setState({ projectDictionaryLocale: "fr_FR" });
    useFilesStore.setState({ projectDictionaryLocale: null });
    window.removeEventListener("oleafly:proofreading-settings-changed", listener);
    useSettingsStore.setState({ dictionaryLocale: "en_US" });
    expect(events).toEqual([]);
  });

  it("flags a project language whose pack is not downloaded", async () => {
    useFilesStore.setState({ projectDictionaryLocale: "it_IT" });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "unavailable",
        identity: IDENTITY,
        message: "The it_IT spelling dictionary could not be loaded.",
        retryable: false,
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    const control = await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    });
    expect(control).toHaveTextContent("Italian (Italy) (not downloaded)");
    expect(
      await screen.findByText(
        "Italian (Italy) is not downloaded, so spelling is not checked. Download it in Settings or pick another language.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(enEditor.proofreading.unavailable),
    ).not.toBeInTheDocument();
  });

  it("trusts a finished spelling pass over an outdated download list", async () => {
    useFilesStore.setState({ projectDictionaryLocale: "it_IT" });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "ready",
        identity: IDENTITY,
        diagnosticCount: 1,
        diagnostics: [hunspellFinding("sbaglio")],
        activeDictionaryLocale: "it_IT",
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    await screen.findByRole("combobox", {
      name: enEditor.projectInfo.spellLanguageAriaLabel,
    });
    expect(statRow(enEditor.projectInfo.spelling)).toHaveTextContent("1");
    expect(
      screen.queryByText(/is not downloaded, so spelling is not checked/),
    ).not.toBeInTheDocument();
  });

  it("drops the missing-pack note once the pack is downloaded", async () => {
    useFilesStore.setState({ projectDictionaryLocale: "it_IT" });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "unavailable",
        identity: IDENTITY,
        retryable: false,
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);
    expect(
      await screen.findByText(/is not downloaded, so spelling is not checked/),
    ).toBeInTheDocument();

    mocks.listDictionaries.mockResolvedValue([
      entry("en_US", "English", "United States", "bundled"),
      entry("it_IT", "Italian", "Italy", "installed"),
    ]);
    await act(async () => {
      await refreshDictionaryCatalog();
    });

    await waitFor(() =>
      expect(
        screen.queryByText(/is not downloaded, so spelling is not checked/),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("combobox", {
        name: enEditor.projectInfo.spellLanguageAriaLabel,
      }),
    ).not.toHaveTextContent("not downloaded");
  });

  it("does not report a clean spelling pass when spelling never ran", async () => {
    useSettingsStore.setState({ harper: true });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "partial",
        identity: IDENTITY,
        message: "Partial proofreading",
        diagnosticCount: 1,
        diagnostics: [{ ...hunspellFinding("teh"), source: "harper", kind: "Style" }],
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    await waitFor(() =>
      expect(statRow(enEditor.projectInfo.spelling)).toHaveTextContent(
        enEditor.projectInfo.notChecked,
      ),
    );
    expect(statRow(enEditor.projectInfo.grammarAndStyle)).toHaveTextContent("1");
  });

  it("keeps the spelling count when only grammar was partial", async () => {
    useSettingsStore.setState({ harper: true });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "partial",
        identity: IDENTITY,
        diagnosticCount: 1,
        diagnostics: [hunspellFinding("teh")],
        activeDictionaryLocale: "en_US",
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    await waitFor(() =>
      expect(statRow(enEditor.projectInfo.spelling)).toHaveTextContent("1"),
    );
  });

  it("says grammar is not checked for a non-English document", async () => {
    useSettingsStore.setState({ harper: true });
    useFilesStore.setState({ projectDictionaryLocale: "fr_FR" });
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "ready",
        identity: IDENTITY,
        diagnosticCount: 1,
        diagnostics: [hunspellFinding("fautte")],
        activeDictionaryLocale: "fr_FR",
      },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    await waitFor(() =>
      expect(statRow(enEditor.projectInfo.grammarAndStyle)).toHaveTextContent(
        enEditor.projectInfo.notChecked,
      ),
    );
    expect(statRow(enEditor.projectInfo.spelling)).toHaveTextContent("1");
    expect(
      screen.getByText(enEditor.projectInfo.grammarEnglishOnly),
    ).toBeInTheDocument();
  });

  it("explains grammar-only checking outside English", async () => {
    useSettingsStore.setState({ spellcheck: false, harper: true });
    useFilesStore.setState({ projectDictionaryLocale: "fr_FR" });
    useProofreadingStore.setState({
      source: { ...IDLE, phase: "unsupported", identity: IDENTITY },
    });
    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    expect(
      await screen.findByText(enEditor.projectInfo.grammarEnglishOnly),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(enEditor.proofreading.unsupported),
    ).not.toBeInTheDocument();
  });
});
