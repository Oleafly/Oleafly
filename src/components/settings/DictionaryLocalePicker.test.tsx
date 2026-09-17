// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
  installDictionary: vi.fn<(id: string) => Promise<void>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listDictionaries: mocks.listDictionaries,
  installDictionary: mocks.installDictionary,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    info: vi.fn(),
  },
  notifyError: mocks.notifyError,
}));

const { DictionaryLocalePicker } = await import("./DictionaryLocalePicker");
const { refreshDictionaryCatalog } = await import(
  "@/lib/proofreading/dictionary-catalog"
);

const copy = enShell.settings.general.dictionary;

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
    bytes: 2_500_000,
    state,
  };
}

function catalog(spanish: DictionaryInfo["state"]): DictionaryInfo[] {
  return [
    entry("en_US", "English", "United States", "bundled"),
    entry("de_DE", "German", "Germany", "bundled"),
    entry("es_ES", "Spanish", "Spain", spanish),
  ];
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
  mocks.listDictionaries.mockResolvedValue(catalog("available"));
  mocks.installDictionary.mockReset();
  mocks.installDictionary.mockResolvedValue();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  useSettingsStore.setState({ dictionaryLocale: "en_US", offline: false });
  await refreshDictionaryCatalog();
});

describe("spelling dictionary picker", () => {
  it("names the selected language and lists the whole catalog", async () => {
    const user = userEvent.setup();
    render(<DictionaryLocalePicker />);

    const control = await screen.findByRole("combobox", {
      name: copy.ariaLabel,
    });
    expect(control).toHaveTextContent("English (United States)");

    await user.click(control);
    expect(
      await screen.findByRole("option", { name: /Spanish \(Spain\)/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /German \(Germany\)/u }),
    ).toBeInTheDocument();
  });

  it("switches straight to a language that is already present", async () => {
    mocks.listDictionaries.mockResolvedValue(catalog("installed"));
    await refreshDictionaryCatalog();
    const user = userEvent.setup();
    render(<DictionaryLocalePicker />);

    await user.click(
      await screen.findByRole("combobox", { name: copy.ariaLabel }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Spanish \(Spain\)/u }),
    );

    await waitFor(() =>
      expect(useSettingsStore.getState().dictionaryLocale).toBe("es_ES"),
    );
    expect(mocks.installDictionary).not.toHaveBeenCalled();
  });

  it("downloads a language that is not present yet, then selects it", async () => {
    mocks.installDictionary.mockImplementation(async () => {
      mocks.listDictionaries.mockResolvedValue(catalog("installed"));
    });
    const user = userEvent.setup();
    render(<DictionaryLocalePicker />);

    await user.click(
      await screen.findByRole("combobox", { name: copy.ariaLabel }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Spanish \(Spain\)/u }),
    );

    await waitFor(() =>
      expect(mocks.installDictionary).toHaveBeenCalledWith("es_ES"),
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().dictionaryLocale).toBe("es_ES"),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      copy.downloaded.replace("{{name}}", "Spanish (Spain)"),
    );
  });

  it("refuses to download while offline mode is on", async () => {
    useSettingsStore.setState({ offline: true });
    const user = userEvent.setup();
    render(<DictionaryLocalePicker />);

    await user.click(
      await screen.findByRole("combobox", { name: copy.ariaLabel }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Spanish \(Spain\)/u }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        copy.offlineRefused.replace("{{name}}", "Spanish (Spain)"),
      ),
    );
    expect(mocks.installDictionary).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().dictionaryLocale).toBe("en_US");
  });
});
