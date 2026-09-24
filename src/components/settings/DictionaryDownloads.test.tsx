// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
  removeDictionary: vi.fn<(id: string) => Promise<void>>(),
  notifyError: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listDictionaries: mocks.listDictionaries,
  removeDictionary: mocks.removeDictionary,
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
  useSettingsStore.setState({ dictionaryLocale: ITALIAN });
  await refreshDictionaryCatalog();
});

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
});
