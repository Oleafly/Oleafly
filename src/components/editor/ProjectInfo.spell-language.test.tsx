// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
  setProjectDictionaryLocaleCmd: vi.fn(),
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
};

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
