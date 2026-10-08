// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => mocks.tauri,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { resetSystemFontsCache } from "@/lib/system-fonts";
import { useSettingsStore } from "@/store/settings";
import { SystemFontPicker, systemFontOptions, type SystemFontUse } from "./SystemFontPicker";

const LABELS = { systemDefault: "Default", monospace: "Mono" };
const FAMILIES = [
  { name: "Arial", monospace: false },
  { name: "Fira Code", monospace: true },
  { name: "iA Writer Mono S", monospace: true },
  { name: "iA Writer Quattro S", monospace: false },
];
const FONT_LABEL = enSettings.appearance.editor.font.label;
const MONOSPACE = enSettings.appearance.editor.font.monospace;
const APP_FONT_LABEL = enSettings.appearance.app.font.label;

function Picker({ use = "editor" }: Readonly<{ use?: SystemFontUse }>) {
  const value = useSettingsStore((state) => (use === "editor" ? state.editorFontFamily : state.appFontFamily));
  const setValue = useSettingsStore((state) =>
    use === "editor" ? state.setEditorFontFamily : state.setAppFontFamily,
  );
  return (
    <SystemFontPicker
      id="font"
      use={use}
      label={use === "editor" ? FONT_LABEL : APP_FONT_LABEL}
      value={value}
      onChange={setValue}
    />
  );
}

function checkedOption() {
  const checked = screen.queryAllByRole("option").filter((option) => option.dataset.checked);
  expect(checked.length).toBeLessThanOrEqual(1);
  return checked[0]?.textContent ?? null;
}

function optionTexts() {
  return screen.queryAllByRole("option").map((option) => option.textContent);
}

beforeEach(() => {
  mocks.tauri = true;
  mocks.invoke.mockResolvedValue(FAMILIES);
  useSettingsStore.setState({ editorFontFamily: "", appFontFamily: "" });
});

afterEach(() => {
  resetSystemFontsCache();
  mocks.invoke.mockReset();
  mocks.logError.mockClear();
});

describe("systemFontOptions", () => {
  it("puts the default first and monospaced families before the rest", () => {
    expect(systemFontOptions(FAMILIES, "", LABELS, true)).toEqual([
      { value: "", label: "Default" },
      { value: "Fira Code", badges: [{ id: "monospace", label: "Mono" }] },
      { value: "iA Writer Mono S", badges: [{ id: "monospace", label: "Mono" }] },
      { value: "Arial", badges: [] },
      { value: "iA Writer Quattro S", badges: [] },
    ]);
  });

  it("filters by name without the default entry while searching", () => {
    expect(systemFontOptions(FAMILIES, " IA writer ", LABELS, true).map((option) => option.value)).toEqual([
      "iA Writer Mono S",
      "iA Writer Quattro S",
    ]);
  });

  it("stops at eighty families", () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ name: `Font ${index}`, monospace: false }));
    expect(systemFontOptions(many, "font", LABELS, true)).toHaveLength(80);
  });

  it("keeps name order without badges when monospaced fonts are not preferred", () => {
    expect(systemFontOptions(FAMILIES, "", LABELS, false)).toEqual([
      { value: "", label: "Default" },
      { value: "Arial", badges: [] },
      { value: "Fira Code", badges: [] },
      { value: "iA Writer Mono S", badges: [] },
      { value: "iA Writer Quattro S", badges: [] },
    ]);
  });
});

describe("SystemFontPicker", () => {
  it("lists the installed fonts and applies the one picked", async () => {
    render(<Picker />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    expect(input).toHaveAttribute("placeholder", enCore.fonts.systemDefault);
    fireEvent.click(input);
    await waitFor(() =>
      expect(optionTexts()).toEqual([
        enCore.fonts.systemDefault,
        `Fira Code${MONOSPACE}`,
        `iA Writer Mono S${MONOSPACE}`,
        "Arial",
        "iA Writer Quattro S",
      ]),
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(checkedOption()).toBe(enCore.fonts.systemDefault);
    fireEvent.click(screen.getByRole("option", { name: "iA Writer Quattro S" }));
    expect(useSettingsStore.getState().editorFontFamily).toBe("iA Writer Quattro S");
    expect(input).toHaveValue("iA Writer Quattro S");
    fireEvent.click(input);
    expect(checkedOption()).toBe("iA Writer Quattro S");
  });

  it("marks the chosen font however its name is cased or spaced", async () => {
    useSettingsStore.setState({ editorFontFamily: "  fira   code " });
    render(<Picker />);
    fireEvent.click(screen.getByRole("combobox", { name: FONT_LABEL }));
    await waitFor(() => expect(checkedOption()).toBe(`Fira Code${MONOSPACE}`));
    expect(screen.getAllByRole("option").filter((option) => option.dataset.checked)).toHaveLength(1);
    expect(screen.getAllByRole("option").map((option) => option.dataset.value)).toEqual([
      "",
      "Fira Code",
      "iA Writer Mono S",
      "Arial",
      "iA Writer Quattro S",
    ]);
  });

  it("says it is looking for fonts until the list arrives", async () => {
    let resolve!: (families: typeof FAMILIES) => void;
    mocks.invoke.mockReturnValue(new Promise((next) => (resolve = next)));
    render(<Picker />);
    fireEvent.focus(screen.getByRole("combobox", { name: FONT_LABEL }));
    expect(screen.getByRole("listbox", { name: enEditor.documentSettings.availableFonts })).toHaveTextContent(
      enEditor.documentSettings.fontsLoading,
    );
    resolve(FAMILIES);
    await waitFor(() => expect(optionTexts()).toHaveLength(5));
  });

  it("uses a typed name that the list does not have and goes back to the default when cleared", async () => {
    useSettingsStore.setState({ editorFontFamily: "Fira Code" });
    render(<Picker />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    fireEvent.change(input, { target: { value: "Berkeley Mono" } });
    expect(useSettingsStore.getState().editorFontFamily).toBe("Berkeley Mono");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(await screen.findByRole("option", { name: enCore.fonts.systemDefault }));
    expect(useSettingsStore.getState().editorFontFamily).toBe("");
  });

  it("offers the suggested fonts when the system list cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("scan failed"));
    render(<Picker />);
    fireEvent.click(screen.getByRole("combobox", { name: FONT_LABEL }));
    await waitFor(() => expect(optionTexts()).toContain(`JetBrains Mono${MONOSPACE}`));
    expect(mocks.logError).toHaveBeenCalledWith("list system fonts for the editor font", expect.any(Error));
  });

  it("lists every installed font by name for the app font and applies the one picked", async () => {
    render(<Picker use="app" />);
    const input = screen.getByRole("combobox", { name: APP_FONT_LABEL });
    fireEvent.click(input);
    await waitFor(() =>
      expect(optionTexts()).toEqual([
        enCore.fonts.systemDefault,
        "Arial",
        "Fira Code",
        "iA Writer Mono S",
        "iA Writer Quattro S",
      ]),
    );
    fireEvent.click(screen.getByRole("option", { name: "iA Writer Quattro S" }));
    expect(useSettingsStore.getState().appFontFamily).toBe("iA Writer Quattro S");
    expect(useSettingsStore.getState().editorFontFamily).toBe("");
  });

  it("offers the suggested app fonts outside the desktop app", () => {
    mocks.tauri = false;
    render(<Picker use="app" />);
    fireEvent.click(screen.getByRole("combobox", { name: APP_FONT_LABEL }));
    expect(optionTexts()).toEqual([
      enCore.fonts.systemDefault,
      "Inter",
      "Helvetica Neue",
      "Segoe UI",
      "Georgia",
    ]);
  });

  it("offers the suggested fonts outside the desktop app without asking for the system list", () => {
    mocks.tauri = false;
    render(<Picker />);
    fireEvent.click(screen.getByRole("combobox", { name: FONT_LABEL }));
    expect(optionTexts()).toEqual([
      enCore.fonts.systemDefault,
      `JetBrains Mono${MONOSPACE}`,
      `Fira Code${MONOSPACE}`,
      `Cascadia Code${MONOSPACE}`,
      `SF Mono${MONOSPACE}`,
      `Menlo${MONOSPACE}`,
      `Consolas${MONOSPACE}`,
    ]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
