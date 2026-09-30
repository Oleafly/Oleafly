// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { ChangedSettingsProvider } from "./changed-settings";
import { ChangedMarker, ResetSettingButton, SettingRow } from "./SettingRow";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "system",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

const LABEL = enSettings.appearance.editor.tabSize.label;
const DESCRIPTION = enSettings.appearance.editor.tabSize.description;
const RESET = enSettings.changed.reset.replace("{{label}}", LABEL);

function renderRow() {
  return render(
    <SettingRow settingId="editorTabSize" label={LABEL} description={DESCRIPTION} testId="tab-size-row">
      <button type="button">{"4"}</button>
    </SettingRow>,
  );
}

describe("SettingRow", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().setEditorTabSize(4);
  });

  it("renders the label, description and control inside a row tagged with its setting", () => {
    renderRow();

    const row = screen.getByTestId("tab-size-row");
    expect(row).toHaveAttribute("data-setting-id", "editorTabSize");
    expect(row).toHaveTextContent(LABEL);
    expect(row).toHaveTextContent(DESCRIPTION);
    expect(screen.getByRole("button", { name: "4" })).toBeInTheDocument();
    expect(row.className).not.toMatch(/(^|\s|:)(ring|outline)(-|\s|$)/u);
  });

  it("marks the row and offers a reset only while the value differs from its default", () => {
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL} testId="tab-size-row">
          <button type="button">{"4"}</button>
        </SettingRow>
      </ChangedSettingsProvider>,
    );
    expect(screen.queryByText(enSettings.changed.marker)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RESET })).not.toBeInTheDocument();

    act(() => useSettingsStore.getState().setEditorTabSize(2));

    expect(screen.getByText(enSettings.changed.marker)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: RESET }));

    expect(useSettingsStore.getState().editorTabSize).toBe(4);
    expect(localStorage.getItem("oleafly.editor.tabSize")).toBe("4");
    expect(screen.queryByRole("button", { name: RESET })).not.toBeInTheDocument();
    expect(screen.queryByText(enSettings.changed.marker)).not.toBeInTheDocument();
  });

  it("announces the changed state on the row's control", () => {
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL}>
          <button type="button">{"4"}</button>
        </SettingRow>
      </ChangedSettingsProvider>,
    );
    const control = screen.getByRole("button", { name: "4" });
    expect(control).not.toHaveAccessibleDescription();

    act(() => useSettingsStore.getState().setEditorTabSize(2));
    expect(control).toHaveAccessibleDescription(enSettings.changed.marker);

    act(() => useSettingsStore.getState().setEditorTabSize(4));
    expect(control).not.toHaveAccessibleDescription();
  });

  it("keeps a labelled control's name to the label and adds the state as its description", () => {
    useSettingsStore.getState().setEditorTabSize(2);
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL} labelFor="tab-size">
          <input id="tab-size" />
        </SettingRow>
      </ChangedSettingsProvider>,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveAccessibleName(LABEL);
    expect(input).toHaveAccessibleDescription(enSettings.changed.marker);
  });

  it("separates the marker from the name it follows", () => {
    render(
      <h3>
        {LABEL}
        <ChangedMarker />
      </h3>,
    );

    expect(screen.getByRole("heading")).toHaveAccessibleName(`${LABEL} ${enSettings.changed.marker}`);
  });

  it("moves keyboard focus to the row's control after a reset", async () => {
    useSettingsStore.getState().setEditorTabSize(2);
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL}>
          <button type="button">{"2"}</button>
        </SettingRow>
      </ChangedSettingsProvider>,
    );
    const reset = screen.getByRole("button", { name: RESET });

    reset.focus();
    fireEvent.click(reset);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "2" })),
    );
  });

  it("puts wrapperClassName on the Reset's outer box and className on the button", () => {
    useSettingsStore.getState().setEditorTabSize(2);
    render(
      <ChangedSettingsProvider>
        <div data-testid="header" className="flex items-center">
          <h3>{LABEL}</h3>
          <ResetSettingButton
            id="editorTabSize"
            label={LABEL}
            wrapperClassName="ml-auto"
            className="-my-1.5"
          />
        </div>
      </ChangedSettingsProvider>,
    );
    const reset = screen.getByRole("button", { name: RESET });

    // The header lays out its direct children, so ml-auto has to sit there.
    const item = [...screen.getByTestId("header").children].find((child) => child.contains(reset));
    expect(item).toHaveClass("ml-auto");
    expect(reset).toHaveClass("-my-1.5");
    expect(reset).not.toHaveClass("ml-auto");
  });

  it("shows no marker outside the Settings dialog provider", () => {
    useSettingsStore.getState().setEditorTabSize(2);
    renderRow();

    expect(screen.queryByText(enSettings.changed.marker)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RESET })).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-size-row").querySelector("[data-setting-reset-slot]")).toBeNull();
  });

  it("keeps the label column's width when an inline row's Reset appears", () => {
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL} description={DESCRIPTION} testId="tab-size-row">
          <button type="button">{"4"}</button>
        </SettingRow>
      </ChangedSettingsProvider>,
    );
    const control = screen.getByRole("button", { name: "4" });
    const actions = control.parentElement;
    if (!actions) throw new Error("actions box is missing");

    // Unchanged: an empty slot the size of Reset holds its place, so a long
    // description does not wrap to another line when Reset shows up.
    const slot = actions.firstElementChild;
    expect(slot).toHaveAttribute("data-setting-reset-slot");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveClass("size-7", "shrink-0");
    expect(slot).toBeEmptyDOMElement();
    expect(actions.childElementCount).toBe(2);

    act(() => useSettingsStore.getState().setEditorTabSize(2));

    const reset = screen.getByRole("button", { name: RESET });
    expect(reset).toHaveClass("size-7", "shrink-0");
    expect(actions.firstElementChild).toContainElement(reset);
    expect(actions.querySelector("[data-setting-reset-slot]")).toBeNull();
    expect(actions.childElementCount).toBe(2);
    expect(actions.lastElementChild).toBe(control);

    act(() => useSettingsStore.getState().setEditorTabSize(4));

    expect(actions.firstElementChild).toHaveAttribute("data-setting-reset-slot");
    expect(actions.childElementCount).toBe(2);
  });

  it("keeps a stacked row's header height when its Reset appears", () => {
    useSettingsStore.getState().setEditorTabSize(2);
    render(
      <ChangedSettingsProvider>
        <SettingRow settingId="editorTabSize" label={LABEL} layout="stacked">
          <button type="button">{"2"}</button>
        </SettingRow>
      </ChangedSettingsProvider>,
    );

    // The 28px button sits on a 20px line: equal negative margins above and
    // below keep it from adding height, and it stays centred on the label.
    const reset = screen.getByRole("button", { name: RESET });
    expect(reset).toHaveClass("-my-1");
    expect(reset).not.toHaveClass("-mt-1");
  });
});
