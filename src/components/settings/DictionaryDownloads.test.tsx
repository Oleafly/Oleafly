// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
  removeDictionary: vi.fn<(id: string) => Promise<void>>(),
  setProjectDictionaryLocaleCmd: vi.fn(),
  resetProjectDictionaryLocaleOnDeviceCmd: vi.fn(),
  forgetProofreadingDictionary: vi.fn((_locale: string) => false),
  notifyError: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listDictionaries: mocks.listDictionaries,
  removeDictionary: mocks.removeDictionary,
  setProjectDictionaryLocaleCmd: mocks.setProjectDictionaryLocaleCmd,
  resetProjectDictionaryLocaleOnDeviceCmd: mocks.resetProjectDictionaryLocaleOnDeviceCmd,
}));

vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  forgetProofreadingDictionary: mocks.forgetProofreadingDictionary,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  notifyError: mocks.notifyError,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const { DictionaryDownloads } = await import("./DictionaryDownloads");
const { refreshDictionaryCatalog } = await import(
  "@/lib/proofreading/dictionary-catalog"
);

const SPANISH = "es_ES";
const ITALIAN = "it_IT";
const REMOVE_SCOPE = "remove the spelling dictionary";

function entry(
  id: string,
  language: string,
  region: string,
  state: DictionaryInfo["state"],
): DictionaryInfo {
  return {
    id,
    language,
    region,
    license: { id: "MIT", url: "https://example.invalid/license" },
    bytes: 2_500_000,
    state,
  };
}

function catalog(spanish: DictionaryInfo["state"]): DictionaryInfo[] {
  return [
    entry("en_US", "English", "United States", "bundled"),
    entry(SPANISH, "Spanish", "Spain", spanish),
    entry(ITALIAN, "Italian", "Italy", "installed"),
  ];
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.listDictionaries.mockResolvedValue(catalog("installed"));
  mocks.removeDictionary.mockImplementation(async () => {
    mocks.listDictionaries.mockResolvedValue(catalog("available"));
  });
  mocks.forgetProofreadingDictionary.mockReturnValue(false);
  mocks.resetProjectDictionaryLocaleOnDeviceCmd.mockImplementation(
    async (_projectId: string) => projectMeta(null),
  );
  useSettingsStore.setState({ dictionaryLocale: ITALIAN });
  useFilesStore.setState({
    projectId: "guide",
    manifestHome: "library",
    projectDictionaryLocale: null,
  });
  await refreshDictionaryCatalog();
});

function projectMeta(locale: string | null) {
  return {
    name: "Guide",
    main_doc: "main.tex",
    engine: "xetex",
    dictionary_locale: locale,
    allow_shell_escape: false,
    checkpoints: { mode: "engine_dependencies" },
  };
}

function recordProofreadingEvents(): { events: string[]; stop: () => void } {
  const events: string[] = [];
  const listener = (event: Event) =>
    events.push((event as CustomEvent<{ setting: string }>).detail.setting);
  window.addEventListener("oleafly:proofreading-settings-changed", listener);
  return {
    events,
    stop: () =>
      window.removeEventListener("oleafly:proofreading-settings-changed", listener),
  };
}

async function removeSpanish() {
  const user = userEvent.setup();
  render(<DictionaryDownloads />);
  await user.click(await screen.findByTestId(`dictionary-remove-${SPANISH}`));
}

describe("downloaded dictionaries", () => {
  it("names the dictionary when it cannot be removed and keeps the backend detail in the log", async () => {
    const failure = new Error("That spelling dictionary could not be removed.");
    mocks.removeDictionary.mockRejectedValue(failure);

    await removeSpanish();

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        REMOVE_SCOPE,
        failure,
        "Could not remove Spanish (Spain).",
      ),
    );
    expect(screen.getByTestId(`dictionary-row-${SPANISH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`dictionary-remove-${SPANISH}`)).toBeEnabled();
  });

  it("falls back to the default language when the selected dictionary is removed", async () => {
    useSettingsStore.setState({ dictionaryLocale: SPANISH });

    await removeSpanish();

    await waitFor(() =>
      expect(screen.queryByTestId(`dictionary-row-${SPANISH}`)).toBeNull(),
    );
    expect(mocks.removeDictionary).toHaveBeenCalledWith(SPANISH);
    expect(useSettingsStore.getState().dictionaryLocale).toBe("en_US");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("keeps the selected language when another dictionary is removed", async () => {
    await removeSpanish();

    await waitFor(() =>
      expect(screen.queryByTestId(`dictionary-row-${SPANISH}`)).toBeNull(),
    );
    expect(useSettingsStore.getState().dictionaryLocale).toBe(ITALIAN);
  });

  it("only logs a list refresh that fails after a successful removal", async () => {
    const listFailure = new Error("list failed");
    mocks.removeDictionary.mockImplementation(async () => {
      mocks.listDictionaries.mockRejectedValue(listFailure);
    });

    await removeSpanish();

    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith(
        "list spelling dictionaries",
        listFailure,
      ),
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(screen.getByTestId(`dictionary-remove-${SPANISH}`)).toBeEnabled();
  });

  it("moves the open project back to the app setting on this device when its dictionary is removed", async () => {
    useFilesStore.setState({ projectDictionaryLocale: SPANISH });
    mocks.forgetProofreadingDictionary.mockReturnValue(true);
    const recorded = recordProofreadingEvents();

    await removeSpanish();

    await waitFor(() =>
      expect(useFilesStore.getState().projectDictionaryLocale).toBeNull(),
    );
    recorded.stop();
    expect(mocks.resetProjectDictionaryLocaleOnDeviceCmd).toHaveBeenCalledWith("guide");
    expect(mocks.setProjectDictionaryLocaleCmd).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().dictionaryLocale).toBe(ITALIAN);
    expect(recorded.events).toEqual(["projectDictionaryLocale"]);
  });

  it("keeps the language an opened folder declares and re-checks against the missing pack", async () => {
    useFilesStore.setState({
      manifestHome: "folder",
      projectDictionaryLocale: "es-ES",
    });
    mocks.forgetProofreadingDictionary.mockReturnValue(true);
    mocks.resetProjectDictionaryLocaleOnDeviceCmd.mockImplementation(
      async (_projectId: string) => projectMeta("es-ES"),
    );
    const recorded = recordProofreadingEvents();

    await removeSpanish();

    await waitFor(() => expect(recorded.events).toEqual(["dictionaryRemoved"]));
    recorded.stop();
    expect(mocks.forgetProofreadingDictionary).toHaveBeenCalledWith(SPANISH);
    expect(mocks.resetProjectDictionaryLocaleOnDeviceCmd).toHaveBeenCalledWith("guide");
    expect(mocks.setProjectDictionaryLocaleCmd).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectDictionaryLocale).toBe("es-ES");
    expect(useSettingsStore.getState().dictionaryLocale).toBe(ITALIAN);
  });

  it("leaves a project on another language alone", async () => {
    useFilesStore.setState({ projectDictionaryLocale: ITALIAN });

    await removeSpanish();

    await waitFor(() =>
      expect(screen.queryByTestId(`dictionary-row-${SPANISH}`)).toBeNull(),
    );
    expect(mocks.resetProjectDictionaryLocaleOnDeviceCmd).not.toHaveBeenCalled();
    expect(mocks.setProjectDictionaryLocaleCmd).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectDictionaryLocale).toBe(ITALIAN);
  });
});
